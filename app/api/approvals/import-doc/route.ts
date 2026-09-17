import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { createAdminClient } from '@/lib/supabase/admin';
import {
    convertGoogleDoc,
    extractDocumentId,
} from '@/lib/approvals/gdocs-to-tiptap';
import {
    extensionForContentType,
    fetchGoogleDoc,
    fetchImageBytes,
    GoogleDocsError,
    probePendingSuggestions,
} from '@/lib/google/docs';
import { loadServiceAccountFromEnv } from '@/lib/google/service-account';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Public bucket holding re-hosted Doc images. Create it alongside campaign-screenshots. */
const IMAGE_BUCKET = 'approval-content';

export async function POST(req: NextRequest) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) { return cookieStore.get(name)?.value; },
                set(name: string, value: string, options: CookieOptions) { cookieStore.set({ name, value, ...options }); },
                remove(name: string, options: CookieOptions) { cookieStore.set({ name, value: '', ...options }); },
            },
        },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const credentials = loadServiceAccountFromEnv();
    if (!credentials) {
        return NextResponse.json({
            error: 'Google service account not configured.',
            hint: 'Set GOOGLE_SERVICE_ACCOUNT_JSON to the credentials JSON, then share the Drive content folder with that service account email.',
        }, { status: 500 });
    }

    const body = await req.json().catch(() => null);
    const { url, batchId, deliverableId, title } = (body ?? {}) as {
        url?: string;
        batchId?: string;
        deliverableId?: string;
        title?: string;
    };

    if (!url) return NextResponse.json({ error: 'A Google Doc link is required.' }, { status: 400 });
    if (!batchId) return NextResponse.json({ error: 'batchId is required.' }, { status: 400 });
    // Not bureaucracy: a document with no deliverable is invisible to the fulfillment
    // matrix, so approving it would close nothing.
    if (!deliverableId) {
        return NextResponse.json({
            error: 'A deliverable must be linked before importing.',
            hint: 'Pick an existing deliverable or create one — approving an unlinked document would not close a commitment.',
        }, { status: 400 });
    }

    const documentId = extractDocumentId(url);
    if (!documentId) {
        return NextResponse.json({
            error: 'That does not look like a Google Doc link.',
            hint: 'Paste the full docs.google.com/document/d/... URL.',
        }, { status: 400 });
    }

    // RLS scopes this — a batch outside the caller's org simply is not found.
    const { data: batch } = await supabase
        .from('content_approval_batches')
        .select('id, organization_id')
        .eq('id', batchId)
        .maybeSingle();

    if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 });

    let doc;
    try {
        doc = await fetchGoogleDoc(credentials, documentId);
    } catch (error) {
        if (error instanceof GoogleDocsError) {
            return NextResponse.json({ error: error.message, hint: error.hint }, { status: error.status === 404 ? 404 : 502 });
        }
        return NextResponse.json({ error: 'Failed to read the Google Doc.' }, { status: 502 });
    }

    // The fetch above used PREVIEW_WITHOUT_SUGGESTIONS, so suggested text is already
    // excluded from what we imported. This probe only adds a warning when the writer left
    // suggestions unresolved — and it returns null under a read-only grant, which cannot
    // see suggestions at all.
    const pendingSuggestions = await probePendingSuggestions(credentials, documentId).catch(() => null);
    if (pendingSuggestions === true) {
        return NextResponse.json({
            error: 'This Google Doc has unresolved suggestions.',
            hint: 'Accept or reject the pending suggestions in Google Docs, then import again — otherwise the imported copy silently excludes them.',
        }, { status: 409 });
    }

    // Re-host images before converting. Google's contentUri expires, so a portal linking
    // to it directly would show the client broken images within days.
    const imageUrls = new Map<string, string>();
    const inlineObjects = doc.inlineObjects ?? {};
    if (Object.keys(inlineObjects).length > 0) {
        const admin = createAdminClient();
        for (const [objectId, object] of Object.entries(inlineObjects)) {
            const contentUri = object.inlineObjectProperties?.embeddedObject?.imageProperties?.contentUri;
            if (!contentUri) continue;

            const image = await fetchImageBytes(credentials, contentUri);
            if (!image) continue;

            const path = `${batch.organization_id}/${documentId}/${objectId}.${extensionForContentType(image.contentType)}`;
            const { error: uploadError } = await admin.storage
                .from(IMAGE_BUCKET)
                .upload(path, image.bytes, { contentType: image.contentType, upsert: true });
            if (uploadError) continue;

            const { data: published } = admin.storage.from(IMAGE_BUCKET).getPublicUrl(path);
            if (published?.publicUrl) imageUrls.set(objectId, published.publicUrl);
        }
    }

    const converted = convertGoogleDoc(doc, {
        resolveImage: (objectId) => imageUrls.get(objectId) ?? null,
    });

    const warnings = [...converted.warnings];
    if (pendingSuggestions === null) {
        warnings.push(
            'Could not check for unresolved Google Docs suggestions (read-only access). Any suggested text was excluded from this import.',
        );
    }

    const { data: lastDoc } = await supabase
        .from('content_approval_docs')
        .select('position')
        .eq('batch_id', batchId)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();

    const { data: inserted, error: insertError } = await supabase
        .from('content_approval_docs')
        .insert({
            batch_id: batchId,
            organization_id: batch.organization_id,
            deliverable_id: deliverableId,
            title: title?.trim() || doc.title || 'Untitled document',
            position: (lastDoc?.position ?? -1) + 1,
            working_json: converted.doc,
            gdoc_document_id: documentId,
            gdoc_revision_id: doc.revisionId ?? null,
            gdoc_imported_at: new Date().toISOString(),
        })
        .select()
        .single();

    if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({
        docId: inserted.id,
        title: inserted.title,
        wordCount: converted.wordCount,
        imageCount: imageUrls.size,
        warnings,
        revisionId: doc.revisionId ?? null,
    });
}

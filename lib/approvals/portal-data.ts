import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { hashToken, shareLinkDenial, type ShareLinkDenial } from './token';
import type {
    ApprovalDocStatus,
    ContentAnchor,
    CommentAuthorType,
    CommentStatus,
    SuggestionKind,
    SuggestionStatus,
} from '../types';

/**
 * Everything the client-facing portal reads and writes.
 *
 * All of it goes through the SERVICE-ROLE client with the share token as the
 * authorization check — clients have no Supabase account, so RLS-as-the-client cannot
 * apply. The token grants exactly one batch and nothing else; every query below is
 * scoped by ids resolved from the token, never by anything the caller supplies.
 */

export interface PortalComment {
    id: string;
    parentId?: string;
    threadRootId?: string;
    authorType: CommentAuthorType;
    authorLabel: string;
    body: string;
    anchor?: ContentAnchor;
    status: CommentStatus;
    createdAt: string;
}

export interface PortalSuggestion {
    id: string;
    kind: SuggestionKind;
    anchor: ContentAnchor;
    payload: string;
    authorLabel: string;
    status: SuggestionStatus;
    createdAt: string;
}

export interface PortalDocument {
    id: string;
    title: string;
    position: number;
    status: ApprovalDocStatus;
    decidedByLabel?: string;
    decidedAt?: string;
    versionId: string;
    versionNo: number;
    wordCount: number;
    /** The PUBLISHED version only. working_json must never reach a client. */
    content: Record<string, unknown>;
    comments: PortalComment[];
    suggestions: PortalSuggestion[];
}

export interface PortalPayload {
    linkId: string;
    allowComments: boolean;
    batch: { id: string; name: string; dueDate?: string; status: string };
    clientName: string;
    documents: PortalDocument[];
}

export type PortalResult =
    | { ok: true; payload: PortalPayload }
    | { ok: false; denial: ShareLinkDenial };

/**
 * Resolve a raw share token to its batch.
 *
 * Lookup is by hash — the raw token is never stored, so a database leak yields no
 * working links.
 */
export async function resolveShareToken(token: string): Promise<PortalResult> {
    if (!token || token.length < 20) return { ok: false, denial: 'not_found' };

    const admin = createAdminClient();

    const { data: link } = await admin
        .from('content_share_links')
        .select('id, batch_id, organization_id, allow_comments, expires_at, revoked_at')
        .eq('token_hash', hashToken(token))
        .maybeSingle();

    const denial = shareLinkDenial(
        link ? { revokedAt: link.revoked_at, expiresAt: link.expires_at } : null,
    );
    if (denial) return { ok: false, denial };

    const { data: batch } = await admin
        .from('content_approval_batches')
        .select('id, name, status, due_date, client_id')
        .eq('id', link!.batch_id)
        .maybeSingle();

    if (!batch) return { ok: false, denial: 'not_found' };

    const { data: client } = await admin
        .from('clients')
        .select('name')
        .eq('id', batch.client_id)
        .maybeSingle();

    const { data: docRows } = await admin
        .from('content_approval_docs')
        .select('id, title, position, status, decided_by_label, decided_at, current_version_id')
        .eq('batch_id', batch.id)
        .is('archived_at', null)
        .order('position');

    const docs = (docRows ?? []).filter((d) => d.current_version_id);
    if (docs.length === 0) {
        return {
            ok: true,
            payload: {
                linkId: link!.id,
                allowComments: link!.allow_comments,
                batch: { id: batch.id, name: batch.name, status: batch.status, dueDate: batch.due_date ?? undefined },
                clientName: client?.name ?? '',
                documents: [],
            },
        };
    }

    const versionIds = docs.map((d) => d.current_version_id as string);
    const docIds = docs.map((d) => d.id);

    const [{ data: versions }, { data: comments }, { data: suggestions }] = await Promise.all([
        admin
            .from('content_doc_versions')
            .select('id, doc_id, version_no, content_json, word_count')
            .in('id', versionIds),
        admin
            .from('content_comments')
            .select('id, doc_id, parent_id, thread_root_id, author_type, author_label, body, anchor, status, created_at')
            .in('doc_id', docIds)
            .order('created_at'),
        admin
            .from('content_suggestions')
            .select('id, doc_id, kind, anchor, payload, author_label, status, created_at')
            .in('doc_id', docIds)
            .order('created_at'),
    ]);

    const versionById = new Map((versions ?? []).map((v) => [v.id, v]));

    const documents: PortalDocument[] = docs.map((doc) => {
        const version = versionById.get(doc.current_version_id as string);
        return {
            id: doc.id,
            title: doc.title,
            position: doc.position,
            status: doc.status as ApprovalDocStatus,
            decidedByLabel: doc.decided_by_label ?? undefined,
            decidedAt: doc.decided_at ?? undefined,
            versionId: version?.id ?? '',
            versionNo: version?.version_no ?? 1,
            wordCount: version?.word_count ?? 0,
            content: (version?.content_json as Record<string, unknown>) ?? { type: 'doc', content: [] },
            comments: (comments ?? [])
                .filter((c) => c.doc_id === doc.id)
                .map((c) => ({
                    id: c.id,
                    parentId: c.parent_id ?? undefined,
                    threadRootId: c.thread_root_id ?? undefined,
                    authorType: c.author_type as CommentAuthorType,
                    authorLabel: c.author_label,
                    body: c.body,
                    anchor: (c.anchor as ContentAnchor) ?? undefined,
                    status: c.status as CommentStatus,
                    createdAt: c.created_at,
                })),
            suggestions: (suggestions ?? [])
                .filter((s) => s.doc_id === doc.id)
                .map((s) => ({
                    id: s.id,
                    kind: s.kind as SuggestionKind,
                    anchor: s.anchor as ContentAnchor,
                    payload: s.payload,
                    authorLabel: s.author_label,
                    status: s.status as SuggestionStatus,
                    createdAt: s.created_at,
                })),
        };
    });

    return {
        ok: true,
        payload: {
            linkId: link!.id,
            allowComments: link!.allow_comments,
            batch: { id: batch.id, name: batch.name, status: batch.status, dueDate: batch.due_date ?? undefined },
            clientName: client?.name ?? '',
            documents,
        },
    };
}

/** Stamp a view. Fire-and-forget — a failed counter must never block the review. */
export async function recordPortalView(linkId: string): Promise<void> {
    const admin = createAdminClient();
    const now = new Date().toISOString();

    const { data: link } = await admin
        .from('content_share_links')
        .select('first_viewed_at, view_count')
        .eq('id', linkId)
        .maybeSingle();

    await admin
        .from('content_share_links')
        .update({
            first_viewed_at: link?.first_viewed_at ?? now,
            last_viewed_at: now,
            view_count: (link?.view_count ?? 0) + 1,
        })
        .eq('id', linkId);
}

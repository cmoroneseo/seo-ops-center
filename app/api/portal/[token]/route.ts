import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { hashToken, shareLinkDenial } from '@/lib/approvals/token';
import { deliverableStatusFor } from '@/lib/approvals/batch-status';
import type { ApprovalDocStatus, ContentAnchor } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Every client-side write in the review portal.
 *
 * One route rather than six, so token verification, batch scoping, and the
 * comments-allowed gate exist in exactly one place and cannot drift apart. The token is
 * the entire authorization: it grants one batch, and every id the caller sends is
 * re-checked against that batch before anything is written.
 */

const MAX_BODY_CHARS = 5000;
const MAX_NAME_CHARS = 80;
/** Writes per link per minute. Crude, but it is real and works on serverless. */
const RATE_LIMIT_PER_MINUTE = 30;

interface ResolvedLink {
    linkId: string;
    batchId: string;
    organizationId: string;
    allowComments: boolean;
}

async function resolveLink(token: string): Promise<{ link: ResolvedLink } | { error: NextResponse }> {
    if (!token || token.length < 20) {
        return { error: NextResponse.json({ error: 'Invalid link.' }, { status: 404 }) };
    }

    const admin = createAdminClient();
    const { data } = await admin
        .from('content_share_links')
        .select('id, batch_id, organization_id, allow_comments, expires_at, revoked_at')
        .eq('token_hash', hashToken(token))
        .maybeSingle();

    const denial = shareLinkDenial(
        data ? { revokedAt: data.revoked_at, expiresAt: data.expires_at } : null,
    );
    if (denial) {
        const status = denial === 'not_found' ? 404 : 410;
        // Deliberately says nothing about the batch — an expired token must not confirm
        // which client or documents it once pointed at.
        return { error: NextResponse.json({ error: denial }, { status }) };
    }

    return {
        link: {
            linkId: data!.id,
            batchId: data!.batch_id,
            organizationId: data!.organization_id,
            allowComments: data!.allow_comments,
        },
    };
}

/** A document id is only usable if it belongs to this token's batch and is live. */
async function assertDocInBatch(docId: string, batchId: string): Promise<string | null> {
    const admin = createAdminClient();
    const { data } = await admin
        .from('content_approval_docs')
        .select('id, current_version_id')
        .eq('id', docId)
        .eq('batch_id', batchId)
        .is('archived_at', null)
        .maybeSingle();

    return data?.current_version_id ?? null;
}

async function withinRateLimit(linkId: string): Promise<boolean> {
    const admin = createAdminClient();
    const since = new Date(Date.now() - 60_000).toISOString();
    const { count } = await admin
        .from('content_comments')
        .select('id', { count: 'exact', head: true })
        .eq('portal_link_id', linkId)
        .gte('created_at', since);

    return (count ?? 0) < RATE_LIMIT_PER_MINUTE;
}

export async function POST(req: NextRequest, context: { params: Promise<{ token: string }> }) {
    const { token } = await context.params;
    const resolved = await resolveLink(token);
    if ('error' in resolved) return resolved.error;
    const { link } = resolved;

    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== 'string') {
        return NextResponse.json({ error: 'action is required.' }, { status: 400 });
    }

    const admin = createAdminClient();

    // ── identify ────────────────────────────────────────────────────────────
    // "Who's reviewing?" — a label for attribution, not an account. Three people at one
    // client share a link; without this every comment reads as "Client".
    if (body.action === 'identify') {
        const name = String(body.name ?? '').trim().slice(0, MAX_NAME_CHARS);
        if (!name) return NextResponse.json({ error: 'A name is required.' }, { status: 400 });

        const email = body.email ? String(body.email).trim().slice(0, 200) : null;
        const now = new Date().toISOString();

        const { data: existing } = await admin
            .from('content_share_reviewers')
            .select('id')
            .eq('share_link_id', link.linkId)
            .eq('name', name)
            .maybeSingle();

        if (existing) {
            await admin.from('content_share_reviewers').update({ last_seen_at: now }).eq('id', existing.id);
            return NextResponse.json({ reviewerId: existing.id, name });
        }

        const { data, error } = await admin
            .from('content_share_reviewers')
            .insert({ share_link_id: link.linkId, organization_id: link.organizationId, name, email })
            .select('id')
            .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ reviewerId: data.id, name });
    }

    if (!link.allowComments && body.action !== 'decide') {
        return NextResponse.json({ error: 'This link is view-only.' }, { status: 403 });
    }

    const authorLabel = String(body.authorLabel ?? '').trim().slice(0, MAX_NAME_CHARS) || 'Client';

    // ── comment ─────────────────────────────────────────────────────────────
    if (body.action === 'comment') {
        if (!(await withinRateLimit(link.linkId))) {
            return NextResponse.json({ error: 'Too many comments too quickly. Wait a moment.' }, { status: 429 });
        }

        const docId = String(body.docId ?? '');
        const versionId = await assertDocInBatch(docId, link.batchId);
        if (!versionId) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });

        const text = String(body.body ?? '').trim().slice(0, MAX_BODY_CHARS);
        if (!text) return NextResponse.json({ error: 'Comment cannot be empty.' }, { status: 400 });

        const parentId = body.parentId ? String(body.parentId) : null;
        const anchor = (body.anchor ?? null) as ContentAnchor | null;
        // A thread root carries the anchor; replies inherit it from the root.
        if (!parentId && !anchor) {
            return NextResponse.json({ error: 'A new thread needs a text selection.' }, { status: 400 });
        }

        const { data, error } = await admin
            .from('content_comments')
            .insert({
                doc_id: docId,
                organization_id: link.organizationId,
                version_id: versionId,
                parent_id: parentId,
                thread_root_id: parentId ? String(body.threadRootId ?? parentId) : null,
                author_type: 'client',
                author_label: authorLabel,
                body: text,
                anchor: parentId ? null : anchor,
                portal_link_id: link.linkId,
            })
            .select()
            .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        // A root thread points at itself, so the whole thread is one query.
        if (!parentId) {
            await admin.from('content_comments').update({ thread_root_id: data.id }).eq('id', data.id);
        }

        return NextResponse.json({ commentId: data.id });
    }

    // ── suggest ─────────────────────────────────────────────────────────────
    // The client cannot edit, so a suggestion is a proposed patch the team accepts or
    // rejects — it never touches the published version.
    if (body.action === 'suggest') {
        if (!(await withinRateLimit(link.linkId))) {
            return NextResponse.json({ error: 'Too many edits too quickly. Wait a moment.' }, { status: 429 });
        }

        const docId = String(body.docId ?? '');
        const versionId = await assertDocInBatch(docId, link.batchId);
        if (!versionId) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });

        const anchor = (body.anchor ?? null) as ContentAnchor | null;
        if (!anchor) return NextResponse.json({ error: 'A suggestion needs a text selection.' }, { status: 400 });

        const kind = ['insert', 'delete', 'replace'].includes(body.kind) ? body.kind : 'replace';
        const payload = String(body.payload ?? '').slice(0, MAX_BODY_CHARS);

        const { data, error } = await admin
            .from('content_suggestions')
            .insert({
                doc_id: docId,
                organization_id: link.organizationId,
                version_id: versionId,
                kind,
                anchor,
                payload,
                origin: 'client',
                author_label: authorLabel,
                portal_link_id: link.linkId,
            })
            .select()
            .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ suggestionId: data.id });
    }

    // ── decide ──────────────────────────────────────────────────────────────
    if (body.action === 'decide') {
        const docId = String(body.docId ?? '');
        if (!(await assertDocInBatch(docId, link.batchId))) {
            return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
        }

        const status = body.status as ApprovalDocStatus;
        if (!['approved', 'approved_with_edits', 'changes_requested'].includes(status)) {
            return NextResponse.json({ error: 'Unknown decision.' }, { status: 400 });
        }

        const now = new Date().toISOString();
        const { data: doc, error: docError } = await admin
            .from('content_approval_docs')
            .update({ status, decided_at: now, decided_by_label: authorLabel, updated_at: now })
            .eq('id', docId)
            .select('deliverable_id')
            .single();

        if (docError) return NextResponse.json({ error: docError.message }, { status: 500 });

        // Writing 'Approved' is the entire mechanism by which an approved batch closes
        // the month's commitment — it is in DELIVERED_STATUSES, and fulfillment is
        // computed on read. `month` is deliberately left alone: an October blog approved
        // in November still closes October.
        const nextDeliverableStatus = deliverableStatusFor(status);
        if (nextDeliverableStatus && doc?.deliverable_id) {
            const { data: deliverable } = await admin
                .from('deliverables')
                .select('status_history')
                .eq('id', doc.deliverable_id)
                .maybeSingle();

            const history = Array.isArray(deliverable?.status_history) ? deliverable.status_history : [];

            await admin
                .from('deliverables')
                .update({
                    status: nextDeliverableStatus,
                    delivered_on: nextDeliverableStatus === 'Approved' ? now : null,
                    status_history: [
                        ...history,
                        { status: nextDeliverableStatus, at: now, by: authorLabel, source: 'content_approval_portal' },
                    ],
                })
                .eq('id', doc.deliverable_id);
        }

        // Roll the batch up: complete only when every live document is accepted.
        const { data: siblings } = await admin
            .from('content_approval_docs')
            .select('status')
            .eq('batch_id', link.batchId)
            .is('archived_at', null);

        const allAccepted = (siblings ?? []).length > 0
            && (siblings ?? []).every((d) => d.status === 'approved' || d.status === 'approved_with_edits');

        await admin
            .from('content_approval_batches')
            .update({
                status: allAccepted ? 'completed' : 'in_review',
                completed_at: allAccepted ? now : null,
                updated_at: now,
            })
            .eq('id', link.batchId);

        return NextResponse.json({ ok: true, batchComplete: allAccepted });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}

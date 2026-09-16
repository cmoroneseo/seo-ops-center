import { createClient } from './client';
import type {
    ApprovalBatchStatus,
    ApprovalDocStatus,
    ContentAnchor,
    ContentApprovalBatch,
    ContentApprovalDoc,
    ContentComment,
    ContentDocVersion,
    ContentSeoMeta,
    ContentShareLink,
    ContentShareReviewer,
    ContentSuggestion,
    DeliverableSubtype,
    SuggestionKind,
    SuggestionOrigin,
    SuggestionStatus,
    CommentAuthorType,
    CommentStatus,
} from '../types';
import { deliverableStatusFor } from '../approvals/batch-status';

// ─── Row Mappers ────────────────────────────────────────────────────────────

export function rowToBatch(row: Record<string, unknown>): ContentApprovalBatch {
    return {
        id: String(row.id),
        organizationId: String(row.organization_id),
        clientId: String(row.client_id),
        name: String(row.name),
        status: row.status as ApprovalBatchStatus,
        dueDate: row.due_date ? String(row.due_date) : undefined,
        createdBy: row.created_by ? String(row.created_by) : undefined,
        sentAt: row.sent_at ? String(row.sent_at) : undefined,
        completedAt: row.completed_at ? String(row.completed_at) : undefined,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
    };
}

export function rowToApprovalDoc(row: Record<string, unknown>): ContentApprovalDoc {
    return {
        id: String(row.id),
        batchId: String(row.batch_id),
        organizationId: String(row.organization_id),
        deliverableId: String(row.deliverable_id),
        title: String(row.title),
        subtype: row.subtype ? (row.subtype as DeliverableSubtype) : undefined,
        position: Number(row.position ?? 0),
        workingJson: (row.working_json as Record<string, unknown>) ?? {},
        currentVersionId: row.current_version_id ? String(row.current_version_id) : undefined,
        reviewLocked: Boolean(row.review_locked),
        status: row.status as ApprovalDocStatus,
        decidedAt: row.decided_at ? String(row.decided_at) : undefined,
        decidedByLabel: row.decided_by_label ? String(row.decided_by_label) : undefined,
        seoMeta: (row.seo_meta as ContentSeoMeta) ?? {},
        gdocDocumentId: row.gdoc_document_id ? String(row.gdoc_document_id) : undefined,
        gdocRevisionId: row.gdoc_revision_id ? String(row.gdoc_revision_id) : undefined,
        gdocImportedAt: row.gdoc_imported_at ? String(row.gdoc_imported_at) : undefined,
        archivedAt: row.archived_at ? String(row.archived_at) : undefined,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
    };
}

export function rowToDocVersion(row: Record<string, unknown>): ContentDocVersion {
    return {
        id: String(row.id),
        docId: String(row.doc_id),
        organizationId: String(row.organization_id),
        versionNo: Number(row.version_no),
        contentJson: (row.content_json as Record<string, unknown>) ?? {},
        contentHtml: row.content_html ? String(row.content_html) : undefined,
        wordCount: Number(row.word_count ?? 0),
        publishedBy: row.published_by ? String(row.published_by) : undefined,
        createdAt: String(row.created_at),
    };
}

export function rowToComment(row: Record<string, unknown>): ContentComment {
    return {
        id: String(row.id),
        docId: String(row.doc_id),
        organizationId: String(row.organization_id),
        versionId: row.version_id ? String(row.version_id) : undefined,
        threadRootId: row.thread_root_id ? String(row.thread_root_id) : undefined,
        parentId: row.parent_id ? String(row.parent_id) : undefined,
        authorType: row.author_type as CommentAuthorType,
        authorUserId: row.author_user_id ? String(row.author_user_id) : undefined,
        authorLabel: String(row.author_label),
        body: String(row.body),
        anchor: (row.anchor as ContentAnchor) ?? undefined,
        status: row.status as CommentStatus,
        resolvedBy: row.resolved_by ? String(row.resolved_by) : undefined,
        resolvedAt: row.resolved_at ? String(row.resolved_at) : undefined,
        taskId: row.task_id ? String(row.task_id) : undefined,
        editedAt: row.edited_at ? String(row.edited_at) : undefined,
        createdAt: String(row.created_at),
    };
}

export function rowToSuggestion(row: Record<string, unknown>): ContentSuggestion {
    return {
        id: String(row.id),
        docId: String(row.doc_id),
        organizationId: String(row.organization_id),
        versionId: row.version_id ? String(row.version_id) : undefined,
        commentId: row.comment_id ? String(row.comment_id) : undefined,
        kind: row.kind as SuggestionKind,
        anchor: row.anchor as ContentAnchor,
        payload: String(row.payload ?? ''),
        origin: row.origin as SuggestionOrigin,
        authorLabel: String(row.author_label),
        status: row.status as SuggestionStatus,
        decidedBy: row.decided_by ? String(row.decided_by) : undefined,
        decidedAt: row.decided_at ? String(row.decided_at) : undefined,
        appliedInVersionId: row.applied_in_version_id ? String(row.applied_in_version_id) : undefined,
        createdAt: String(row.created_at),
    };
}

export function rowToShareLink(row: Record<string, unknown>): ContentShareLink {
    return {
        id: String(row.id),
        batchId: String(row.batch_id),
        organizationId: String(row.organization_id),
        tokenHash: String(row.token_hash),
        allowComments: Boolean(row.allow_comments),
        expiresAt: row.expires_at ? String(row.expires_at) : undefined,
        revokedAt: row.revoked_at ? String(row.revoked_at) : undefined,
        firstViewedAt: row.first_viewed_at ? String(row.first_viewed_at) : undefined,
        lastViewedAt: row.last_viewed_at ? String(row.last_viewed_at) : undefined,
        viewCount: Number(row.view_count ?? 0),
        createdBy: row.created_by ? String(row.created_by) : undefined,
        createdAt: String(row.created_at),
    };
}

export function rowToShareReviewer(row: Record<string, unknown>): ContentShareReviewer {
    return {
        id: String(row.id),
        shareLinkId: String(row.share_link_id),
        organizationId: String(row.organization_id),
        name: String(row.name),
        email: row.email ? String(row.email) : undefined,
        firstSeenAt: String(row.first_seen_at),
        lastSeenAt: String(row.last_seen_at),
    };
}

// ─── Batches ────────────────────────────────────────────────────────────────

export async function listBatchesForClient(clientId: string): Promise<ContentApprovalBatch[]> {
    const supabase = createClient();
    if (!supabase) return [];

    const { data } = await supabase
        .from('content_approval_batches')
        .select('*')
        .eq('client_id', clientId)
        .neq('status', 'archived')
        .order('created_at', { ascending: false });

    return (data ?? []).map(rowToBatch);
}

export async function getBatch(batchId: string): Promise<ContentApprovalBatch | null> {
    const supabase = createClient();
    if (!supabase) return null;

    const { data } = await supabase
        .from('content_approval_batches')
        .select('*')
        .eq('id', batchId)
        .maybeSingle();

    return data ? rowToBatch(data) : null;
}

export async function createBatch(input: {
    organizationId: string;
    clientId: string;
    name: string;
    dueDate?: string;
    createdBy?: string;
}): Promise<{ data: ContentApprovalBatch | null; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { data: null, error: 'Supabase not initialized' };

    const { data, error } = await supabase
        .from('content_approval_batches')
        .insert({
            organization_id: input.organizationId,
            client_id: input.clientId,
            name: input.name,
            due_date: input.dueDate ?? null,
            created_by: input.createdBy ?? null,
        })
        .select()
        .single();

    if (error) return { data: null, error: error.message };
    return { data: rowToBatch(data) };
}

export async function updateBatch(
    batchId: string,
    patch: Partial<Pick<ContentApprovalBatch, 'name' | 'status' | 'dueDate' | 'sentAt' | 'completedAt'>>,
): Promise<{ data: ContentApprovalBatch | null; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { data: null, error: 'Supabase not initialized' };

    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
    if (patch.sentAt !== undefined) row.sent_at = patch.sentAt;
    if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;

    const { data, error } = await supabase
        .from('content_approval_batches')
        .update(row)
        .eq('id', batchId)
        .select()
        .single();

    if (error) return { data: null, error: error.message };
    return { data: rowToBatch(data) };
}

/**
 * Delete a batch outright. Cascades to its documents, versions, comments, suggestions
 * and share links (verified against the database).
 *
 * Only for batches that were never sent — see lib/approvals/removal.ts. Once a client
 * has seen it, the approvals are a record and `archiveBatch` is the right call.
 */
export async function deleteBatch(batchId: string): Promise<{ ok: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { ok: false, error: 'Supabase not initialized' };

    const { data: batch } = await supabase
        .from('content_approval_batches')
        .select('sent_at')
        .eq('id', batchId)
        .maybeSingle();

    if (!batch) return { ok: false, error: 'Batch not found' };
    if (batch.sent_at) {
        return {
            ok: false,
            error: 'This batch has already gone to the client. Archive it instead — the approvals are a record.',
        };
    }

    const { error } = await supabase.from('content_approval_batches').delete().eq('id', batchId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

/** Hide a batch without destroying its approvals, and revoke any live link. */
export async function archiveBatch(batchId: string): Promise<{ ok: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { ok: false, error: 'Supabase not initialized' };

    const now = new Date().toISOString();

    // Revoke first: an archived batch a client can still open is worse than either state.
    await supabase
        .from('content_share_links')
        .update({ revoked_at: now })
        .eq('batch_id', batchId)
        .is('revoked_at', null);

    const { error } = await supabase
        .from('content_approval_batches')
        .update({ status: 'archived', updated_at: now })
        .eq('id', batchId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

/** Remove an undecided document. A decided one must be archived instead. */
export async function deleteApprovalDoc(docId: string): Promise<{ ok: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { ok: false, error: 'Supabase not initialized' };

    const { data: doc } = await supabase
        .from('content_approval_docs')
        .select('status')
        .eq('id', docId)
        .maybeSingle();

    if (!doc) return { ok: false, error: 'Document not found' };
    if (doc.status !== 'pending') {
        return { ok: false, error: 'The client has already decided on this document. Archive it instead.' };
    }

    const { error } = await supabase.from('content_approval_docs').delete().eq('id', docId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

// ─── Documents ──────────────────────────────────────────────────────────────

export async function listDocsForBatch(batchId: string): Promise<ContentApprovalDoc[]> {
    const supabase = createClient();
    if (!supabase) return [];

    const { data } = await supabase
        .from('content_approval_docs')
        .select('*')
        .eq('batch_id', batchId)
        .order('position');

    return (data ?? []).map(rowToApprovalDoc);
}

export async function createApprovalDoc(input: {
    batchId: string;
    organizationId: string;
    /** Required — an unlinked document is invisible to the fulfillment matrix. */
    deliverableId: string;
    title: string;
    subtype?: DeliverableSubtype;
    position?: number;
    workingJson: Record<string, unknown>;
    seoMeta?: ContentSeoMeta;
    gdocDocumentId?: string;
    gdocRevisionId?: string;
}): Promise<{ data: ContentApprovalDoc | null; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { data: null, error: 'Supabase not initialized' };

    const { data, error } = await supabase
        .from('content_approval_docs')
        .insert({
            batch_id: input.batchId,
            organization_id: input.organizationId,
            deliverable_id: input.deliverableId,
            title: input.title,
            subtype: input.subtype ?? null,
            position: input.position ?? 0,
            working_json: input.workingJson,
            seo_meta: input.seoMeta ?? {},
            gdoc_document_id: input.gdocDocumentId ?? null,
            gdoc_revision_id: input.gdocRevisionId ?? null,
            gdoc_imported_at: input.gdocDocumentId ? new Date().toISOString() : null,
        })
        .select()
        .single();

    if (error) return { data: null, error: error.message };
    return { data: rowToApprovalDoc(data) };
}

/**
 * Save the internal working draft.
 *
 * Refuses while the document is locked for client review — a document is either open for
 * review or open for editing, never both. Without that invariant the client's comments
 * and the writer's edits diverge, and anchors stop mapping cleanly.
 */
export async function saveWorkingDraft(
    docId: string,
    workingJson: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { ok: false, error: 'Supabase not initialized' };

    const { data: current } = await supabase
        .from('content_approval_docs')
        .select('review_locked')
        .eq('id', docId)
        .maybeSingle();

    if (!current) return { ok: false, error: 'Document not found' };
    if (current.review_locked) {
        return { ok: false, error: 'Document is locked for client review. Close the review round to edit.' };
    }

    const { error } = await supabase
        .from('content_approval_docs')
        .update({ working_json: workingJson, updated_at: new Date().toISOString() })
        .eq('id', docId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

export async function setReviewLock(
    docId: string,
    locked: boolean,
): Promise<{ ok: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { ok: false, error: 'Supabase not initialized' };

    const { error } = await supabase
        .from('content_approval_docs')
        .update({ review_locked: locked, updated_at: new Date().toISOString() })
        .eq('id', docId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

export async function archiveApprovalDoc(docId: string): Promise<{ ok: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { ok: false, error: 'Supabase not initialized' };

    const { error } = await supabase
        .from('content_approval_docs')
        .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', docId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

// ─── Versions ───────────────────────────────────────────────────────────────

export async function listVersions(docId: string): Promise<ContentDocVersion[]> {
    const supabase = createClient();
    if (!supabase) return [];

    const { data } = await supabase
        .from('content_doc_versions')
        .select('*')
        .eq('doc_id', docId)
        .order('version_no', { ascending: false });

    return (data ?? []).map(rowToDocVersion);
}

/**
 * Snapshot the working draft as the next immutable version and point the document at it.
 * This is what the client reads — they never see an unpublished working draft.
 */
export async function publishVersion(input: {
    docId: string;
    organizationId: string;
    contentJson: Record<string, unknown>;
    contentHtml?: string;
    wordCount: number;
    publishedBy?: string;
}): Promise<{ data: ContentDocVersion | null; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { data: null, error: 'Supabase not initialized' };

    const { data: last } = await supabase
        .from('content_doc_versions')
        .select('version_no')
        .eq('doc_id', input.docId)
        .order('version_no', { ascending: false })
        .limit(1)
        .maybeSingle();

    const nextNo = (last?.version_no ?? 0) + 1;

    const { data, error } = await supabase
        .from('content_doc_versions')
        .insert({
            doc_id: input.docId,
            organization_id: input.organizationId,
            version_no: nextNo,
            content_json: input.contentJson,
            content_html: input.contentHtml ?? null,
            word_count: input.wordCount,
            published_by: input.publishedBy ?? null,
        })
        .select()
        .single();

    if (error) return { data: null, error: error.message };

    const version = rowToDocVersion(data);
    await supabase
        .from('content_approval_docs')
        .update({ current_version_id: version.id, updated_at: new Date().toISOString() })
        .eq('id', input.docId);

    return { data: version };
}

// ─── Decisions ──────────────────────────────────────────────────────────────

/**
 * Record a client decision and propagate it to the linked deliverable.
 *
 * Writing `deliverables.status = 'Approved'` is the entire mechanism by which an approved
 * batch closes the month's commitment — 'Approved' is one of `DELIVERED_STATUSES` in
 * fulfillment.ts, which is computed on read. Nothing is stored as a rollup here.
 */
export async function decideDocument(input: {
    docId: string;
    status: ApprovalDocStatus;
    decidedByLabel: string;
}): Promise<{ ok: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { ok: false, error: 'Supabase not initialized' };

    const { data: doc, error: docError } = await supabase
        .from('content_approval_docs')
        .update({
            status: input.status,
            decided_at: new Date().toISOString(),
            decided_by_label: input.decidedByLabel,
            updated_at: new Date().toISOString(),
        })
        .eq('id', input.docId)
        .select('deliverable_id')
        .single();

    if (docError) return { ok: false, error: docError.message };

    const nextDeliverableStatus = deliverableStatusFor(input.status);
    if (!nextDeliverableStatus || !doc?.deliverable_id) return { ok: true };

    const { data: deliverable } = await supabase
        .from('deliverables')
        .select('status_history')
        .eq('id', doc.deliverable_id)
        .maybeSingle();

    const history = Array.isArray(deliverable?.status_history) ? deliverable.status_history : [];

    const { error: deliverableError } = await supabase
        .from('deliverables')
        .update({
            status: nextDeliverableStatus,
            // Do NOT re-stamp `month` — an October blog approved in November still closes
            // October, and month is what buckets it in the fulfillment matrix.
            delivered_on: nextDeliverableStatus === 'Approved' ? new Date().toISOString() : null,
            status_history: [
                ...history,
                {
                    status: nextDeliverableStatus,
                    at: new Date().toISOString(),
                    by: input.decidedByLabel,
                    source: 'content_approval_portal',
                },
            ],
        })
        .eq('id', doc.deliverable_id);

    if (deliverableError) return { ok: false, error: deliverableError.message };
    return { ok: true };
}

// ─── Comments ───────────────────────────────────────────────────────────────

export async function listComments(docId: string): Promise<ContentComment[]> {
    const supabase = createClient();
    if (!supabase) return [];

    const { data } = await supabase
        .from('content_comments')
        .select('*')
        .eq('doc_id', docId)
        .order('created_at');

    return (data ?? []).map(rowToComment);
}

export async function createComment(input: {
    docId: string;
    organizationId: string;
    versionId?: string;
    parentId?: string;
    threadRootId?: string;
    authorType: CommentAuthorType;
    authorUserId?: string;
    authorLabel: string;
    body: string;
    anchor?: ContentAnchor;
}): Promise<{ data: ContentComment | null; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { data: null, error: 'Supabase not initialized' };

    const { data, error } = await supabase
        .from('content_comments')
        .insert({
            doc_id: input.docId,
            organization_id: input.organizationId,
            version_id: input.versionId ?? null,
            parent_id: input.parentId ?? null,
            thread_root_id: input.threadRootId ?? null,
            author_type: input.authorType,
            author_user_id: input.authorUserId ?? null,
            author_label: input.authorLabel,
            body: input.body,
            anchor: input.anchor ?? null,
        })
        .select()
        .single();

    if (error) return { data: null, error: error.message };
    return { data: rowToComment(data) };
}

export async function setCommentStatus(
    commentId: string,
    status: CommentStatus,
    resolvedBy?: string,
): Promise<{ ok: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { ok: false, error: 'Supabase not initialized' };

    const { error } = await supabase
        .from('content_comments')
        .update({
            status,
            resolved_by: status === 'resolved' ? (resolvedBy ?? null) : null,
            resolved_at: status === 'resolved' ? new Date().toISOString() : null,
        })
        .eq('id', commentId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

/**
 * Persist re-mapped anchors after an editing session.
 *
 * A comment whose range collapsed becomes `orphaned` with its quoted text intact — it is
 * never deleted. Silently losing client feedback is the worst failure mode here.
 */
export async function persistAnchors(
    updates: Array<{ id: string; anchor: ContentAnchor | null }>,
): Promise<{ ok: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { ok: false, error: 'Supabase not initialized' };

    for (const update of updates) {
        const { error } = await supabase
            .from('content_comments')
            .update(
                update.anchor
                    ? { anchor: update.anchor }
                    : { status: 'orphaned' },
            )
            .eq('id', update.id);
        if (error) return { ok: false, error: error.message };
    }

    return { ok: true };
}

// ─── Suggestions ────────────────────────────────────────────────────────────

export async function listSuggestions(docId: string): Promise<ContentSuggestion[]> {
    const supabase = createClient();
    if (!supabase) return [];

    const { data } = await supabase
        .from('content_suggestions')
        .select('*')
        .eq('doc_id', docId)
        .order('created_at');

    return (data ?? []).map(rowToSuggestion);
}

export async function createSuggestion(input: {
    docId: string;
    organizationId: string;
    versionId?: string;
    commentId?: string;
    kind: SuggestionKind;
    anchor: ContentAnchor;
    payload: string;
    origin: SuggestionOrigin;
    authorLabel: string;
}): Promise<{ data: ContentSuggestion | null; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { data: null, error: 'Supabase not initialized' };

    const { data, error } = await supabase
        .from('content_suggestions')
        .insert({
            doc_id: input.docId,
            organization_id: input.organizationId,
            version_id: input.versionId ?? null,
            comment_id: input.commentId ?? null,
            kind: input.kind,
            anchor: input.anchor,
            payload: input.payload,
            origin: input.origin,
            author_label: input.authorLabel,
        })
        .select()
        .single();

    if (error) return { data: null, error: error.message };
    return { data: rowToSuggestion(data) };
}

export async function decideSuggestion(input: {
    suggestionId: string;
    status: Exclude<SuggestionStatus, 'pending'>;
    decidedBy?: string;
}): Promise<{ ok: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { ok: false, error: 'Supabase not initialized' };

    const { error } = await supabase
        .from('content_suggestions')
        .update({
            status: input.status,
            decided_by: input.decidedBy ?? null,
            decided_at: new Date().toISOString(),
        })
        .eq('id', input.suggestionId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

// ─── Share links ────────────────────────────────────────────────────────────

export async function getShareLinksForBatch(batchId: string): Promise<ContentShareLink[]> {
    const supabase = createClient();
    if (!supabase) return [];

    const { data } = await supabase
        .from('content_share_links')
        .select('*')
        .eq('batch_id', batchId)
        .order('created_at', { ascending: false });

    return (data ?? []).map(rowToShareLink);
}

export async function revokeShareLink(linkId: string): Promise<{ ok: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { ok: false, error: 'Supabase not initialized' };

    const { error } = await supabase
        .from('content_share_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', linkId);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
}

export async function listReviewers(shareLinkId: string): Promise<ContentShareReviewer[]> {
    const supabase = createClient();
    if (!supabase) return [];

    const { data } = await supabase
        .from('content_share_reviewers')
        .select('*')
        .eq('share_link_id', shareLinkId)
        .order('first_seen_at');

    return (data ?? []).map(rowToShareReviewer);
}

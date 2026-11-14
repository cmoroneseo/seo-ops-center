import { createHash } from 'node:crypto';

export const PUBLIC_REVIEW_HEADERS = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
} as const;

export type ReviewState = 'active' | 'expired' | 'revoked';

export interface PublicPostView {
    id: string;
    position: number;
    status: 'pending' | 'approved' | 'changes_requested';
    locked: boolean;
    versionId: string;
    versionNo: number;
    title: string;
    body: string;
    postType: string;
    offerStart: string | null;
    offerEnd: string | null;
    scheduledDate: string;
    ctaUrl: string;
    ctaLabel: string;
    terms: string;
    photoSrc: string | null;
    changeNote: string | null;
    previous: { body: string; photoSrc: string | null } | null;
    decision: { decision: string; comment: string | null; suggestedTitle: string | null; suggestedBody: string | null } | null;
}

export interface PublicQuestionView {
    id: string;
    prompt: string;
    itemId: string | null;
    answer: string | null;
}

export interface PublicReviewView {
    state: ReviewState;
    title: string;
    clientName: string;
    dueAt: string | null;
    round: number;
    expiresAt: string | null;
    hadSubmission: boolean;
    posts: PublicPostView[];
    questions: PublicQuestionView[];
    summary: {
        approved: number;
        changesRequested: number;
        pending: number;
        questionsAnswered: number;
        questionsTotal: number;
    };
}

const STATUS_CODES = new Set([
    'not_found',
    'expired',
    'revoked',
    'refresh_required',
    'decision_locked',
    'idempotency_conflict',
    'rate_limited',
    'name_required',
    'comment_required',
    'invalid_request',
    'nothing_to_send',
    'upload_not_verified',
    'out_of_scope',
    'forbidden',
    'link_exists',
    'change_note_required',
    'not_ready',
]);

export function publicStatus(code: string): number {
    if (code === 'not_found') return 404;
    if (code === 'expired' || code === 'revoked') return 410;
    if (code === 'rate_limited') return 429;
    if (code === 'forbidden') return 403;
    if (code === 'refresh_required' || code === 'decision_locked' || code === 'idempotency_conflict' || code === 'link_exists') return 409;
    return 400;
}

export function publicMessage(code: string): string {
    switch (code) {
        case 'refresh_required':
            return 'These posts were updated. Refresh the page and review the latest versions.';
        case 'decision_locked':
            return 'That post is locked because the agency already acted on it. Refresh to see the latest.';
        case 'name_required':
            return 'Enter your name so we know who reviewed these posts.';
        case 'comment_required':
            return 'Add a comment so we know what to change.';
        case 'rate_limited':
            return 'Too many attempts. Wait a few minutes and try again.';
        case 'expired':
            return 'This link has expired. Contact your account manager for a new one.';
        case 'revoked':
            return 'This link was turned off. Contact your account manager if you still need to review.';
        case 'not_found':
            return "This link isn't available.";
        case 'nothing_to_send':
            return 'Approve a post, request a change, or answer a question before you send.';
        default:
            return STATUS_CODES.has(code) ? 'That review could not be saved.' : 'That review could not be saved.';
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

/**
 * Copies only the fields the client page is allowed to render.
 * Storage paths, tokens, organization ids, emails, and IP hashes never leave here.
 */
export function projectPublicReview(
    raw: unknown,
    photoSrcFor: (path: string) => string | null = () => null,
): PublicReviewView | { code: string } {
    const row = asRecord(raw);
    if (!row || row.ok === false) return { code: text(row?.code) ?? 'not_found' };
    const state = row.state;
    if (state !== 'active' && state !== 'expired' && state !== 'revoked') return { code: 'not_found' };
    const summary = asRecord(row.summary);
    const posts = state === 'active' && Array.isArray(row.items)
        ? row.items.flatMap(item => {
            const record = asRecord(item);
            const version = asRecord(record?.version);
            const payload = asRecord(version?.payload);
            if (!record || !version || !payload) return [];
            const previous = asRecord(version.previous);
            const previousPayload = asRecord(previous?.payload);
            const decision = asRecord(record.decision);
            const photoPath = text(version.photoPath);
            const previousPhoto = text(previous?.photoPath);
            const replacement = text(decision?.replacementPhotoPath);
            return [{
                id: String(record.id),
                position: Number(record.position),
                status: record.status === 'approved' || record.status === 'changes_requested' ? record.status : 'pending',
                locked: record.locked === true,
                versionId: String(version.id),
                versionNo: Number(version.versionNo),
                title: text(payload.title) ?? '',
                body: text(payload.body) ?? '',
                postType: text(payload.postType) ?? 'offer',
                offerStart: text(payload.offerStart),
                offerEnd: text(payload.offerEnd),
                scheduledDate: text(payload.scheduledDate) ?? '',
                ctaUrl: text(payload.ctaUrl) ?? '',
                ctaLabel: text(payload.ctaLabel) ?? 'View offer',
                terms: text(payload.terms) ?? '',
                photoSrc: photoPath ? photoSrcFor(photoPath) : replacement ? photoSrcFor(replacement) : null,
                changeNote: text(version.changeNote),
                previous: previousPayload ? {
                    body: text(previousPayload.body) ?? '',
                    photoSrc: previousPhoto ? photoSrcFor(previousPhoto) : null,
                } : null,
                decision: decision ? {
                    decision: text(decision.decision) ?? '',
                    comment: text(decision.comment),
                    suggestedTitle: text(decision.suggestedTitle),
                    suggestedBody: text(decision.suggestedBody),
                } : null,
            } satisfies PublicPostView];
        })
        : [];
    const questions = state === 'active' && Array.isArray(row.questions)
        ? row.questions.flatMap(item => {
            const record = asRecord(item);
            if (!record) return [];
            return [{
                id: String(record.id),
                prompt: text(record.prompt) ?? '',
                itemId: text(record.itemId),
                answer: text(record.answer),
            } satisfies PublicQuestionView];
        })
        : [];
    return {
        state,
        title: text(row.title) ?? 'Review',
        clientName: text(row.clientName) ?? 'your account',
        dueAt: text(row.dueAt),
        round: typeof row.round === 'number' ? row.round : 1,
        expiresAt: text(row.expiresAt),
        hadSubmission: row.hadSubmission === true,
        posts,
        questions,
        summary: {
            approved: Number(summary?.approved ?? posts.filter(post => post.status === 'approved').length),
            changesRequested: Number(summary?.changesRequested ?? posts.filter(post => post.status === 'changes_requested').length),
            pending: Number(summary?.pending ?? posts.filter(post => post.status === 'pending').length),
            questionsAnswered: Number(summary?.questionsAnswered ?? questions.filter(question => question.answer?.trim()).length),
            questionsTotal: Number(summary?.questionsTotal ?? questions.length),
        },
    };
}

export function submissionHash(body: {
    respondentName: string;
    respondentEmail?: string | null;
    displayedVersionIds: string[];
    decisions: unknown[];
    answers: unknown[];
}): string {
    const stable = JSON.stringify({
        name: body.respondentName.trim(),
        email: body.respondentEmail?.trim() ?? '',
        versions: [...body.displayedVersionIds].sort(),
        decisions: body.decisions,
        answers: body.answers,
    });
    return createHash('sha256').update(stable).digest('hex');
}

export function hashIp(ip: string, pepper: string): string {
    return createHash('sha256').update(`${pepper}\n${ip}`).digest('hex');
}

/** When every current item is approved, a to-do task moves to in progress. Never to done. */
export function taskStatusAfterFullApproval(status: string, allApproved: boolean): string {
    if (allApproved && status === 'todo') return 'in_progress';
    return status;
}

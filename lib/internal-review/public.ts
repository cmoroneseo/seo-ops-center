import { z } from 'zod';
import { hashToken } from '@/lib/approvals/token';
import { uuid } from '@/lib/approvals-v2/list';
import { MAX_GBP_PHOTOS, versionPhotoPaths } from '@/lib/gbp-approvals/photos';
import { signApprovalPhoto } from '@/lib/gbp-approvals/live';
import { PUBLIC_REVIEW_HEADERS } from '@/lib/gbp-approvals/public-headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { RETRY_KEY_PATTERN, UNAVAILABLE_REVIEW, webUrl, type InternalReviewView } from './model';

const id = z.string().regex(uuid);
const decision = z.enum(['approved', 'changes_requested']);
const photoPosition = z.number().int().min(1).max(MAX_GBP_PHOTOS).nullish();
const feedback = z.object({
    reviewerName: z.string(),
    decision: decision.nullable(),
    comment: z.string().nullable(),
    photoPosition,
});
const rawView = z.object({
    ok: z.literal(true),
    clientName: z.string(),
    batches: z.array(z.object({
        requestId: id,
        title: z.string(),
        posts: z.array(z.object({
            itemId: id,
            versionId: id,
            position: z.number(),
            title: z.string().nullable(),
            body: z.string().nullable(),
            postType: z.string().nullable(),
            scheduledDate: z.string().nullable(),
            offerStart: z.string().nullable(),
            offerEnd: z.string().nullable(),
            terms: z.string().nullable(),
            ctaUrl: z.string().nullable(),
            ctaLabel: z.string().nullable(),
            photoPath: z.string().nullable(),
            photoPaths: z.array(z.string()).max(MAX_GBP_PHOTOS).optional(),
            videoPath: z.string().nullish(),
            videoPosterPath: z.string().nullish(),
            feedback: z.array(feedback),
        })).min(1),
    })).min(1),
});
const draftFeedback = feedback.extend({
    itemId: id,
    versionId: id,
    reviewerName: z.string().trim().min(1).max(120),
    comment: z.string().trim().max(4000).nullable(),
    idempotencyKey: z.string().regex(RETRY_KEY_PATTERN),
});

const unknownTokenHash = hashToken('invalid-internal-review-token');

// Keep malformed links on the same indexed lookup path as unknown tokens.
function lookupHash(token: string) {
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? hashToken(token) : unknownTokenHash;
}

function photoSource(requestId: string, path: string | null, sign: typeof signApprovalPhoto) {
    if (!path) return null;
    const asset = /^(?:gbp-approvals|approval-assets)\/([0-9a-f-]{36})\/[0-9a-f-]{36}(?:\.preview\.jpg)?$/.exec(path);
    if (asset?.[1] === requestId) return sign(path).then(webUrl).catch(() => null);
    return webUrl(path);
}

export function createInternalReviewLoader(admin = createAdminClient, sign = signApprovalPhoto, clock = () => new Date()) {
    return async function load(token: string): Promise<InternalReviewView | null> {
        try {
            const { data, error } = await admin().rpc('get_approval_internal_review', {
                p_token_hash: lookupHash(token),
                p_now: clock().toISOString(),
            });
            const parsed = rawView.safeParse(data);
            if (error || !parsed.success) return null;
            const { clientName, batches } = parsed.data;
            return {
                clientName,
                batches: await Promise.all(batches.map(async ({ title, requestId, posts }) => ({
                    title,
                    posts: await Promise.all(posts.map(async ({ photoPath, photoPaths, videoPath, videoPosterPath, ...post }) => {
                        const photoSrcs = await Promise.all(versionPhotoPaths(photoPaths, photoPath)
                            .map(path => photoSource(requestId, path, sign)));
                        return {
                            ...post,
                            title: post.title ?? '',
                            body: post.body ?? '',
                            postType: post.postType ?? '',
                            scheduledDate: post.scheduledDate ?? '',
                            terms: post.terms ?? '',
                            ctaUrl: webUrl(post.ctaUrl),
                            ctaLabel: post.ctaLabel ?? '',
                            photoSrc: photoSrcs[0] ?? null,
                            photoSrcs,
                            ...(videoPath ? {
                                videoSrc: await photoSource(requestId, videoPath, sign),
                                videoPosterSrc: await photoSource(requestId, videoPosterPath ?? null, sign),
                            } : {}),
                        };
                    })),
                }))),
            };
        } catch {
            return null;
        }
    };
}

export const loadInternalReview = createInternalReviewLoader();
type Context = { params: Promise<{ token: string }> };

function json(body: unknown, status = 200) {
    return Response.json(body, { headers: PUBLIC_REVIEW_HEADERS, status });
}

function unavailable() {
    return json({ error: UNAVAILABLE_REVIEW }, 404);
}

export function createInternalReviewGet(load = loadInternalReview) {
    return async function GET(_request: Request, context: Context) {
        const view = await load((await context.params).token);
        return view ? json(view) : unavailable();
    };
}

export function createInternalFeedbackPost(admin = createAdminClient, clock = () => new Date()) {
    return async function POST(request: Request, context: Context) {
        const { token } = await context.params;
        const body = await request.json().catch(() => null);
        const parsed = draftFeedback.safeParse(body);
        const value = parsed.data;
        const itemId = id.safeParse(body?.itemId).data ?? null;
        try {
            const { data, error } = await admin().rpc('submit_approval_internal_feedback', {
                p_token_hash: lookupHash(token),
                p_item_id: itemId,
                p_version_id: value?.versionId ?? null,
                p_reviewer_name: value?.reviewerName ?? null,
                p_decision: value?.decision ?? null,
                p_comment: value?.comment ?? null,
                p_idempotency_key: value?.idempotencyKey ?? null,
                p_now: clock().toISOString(),
                ...(value?.photoPosition != null ? { p_photo_position: value.photoPosition } : {}),
            });
            if (error || !data) return unavailable();
            if (data.ok === true) return json({ ok: true, ...(data.idempotent === true ? { idempotent: true } : {}) });
            switch (data.code) {
                case 'refresh_required':
                    return json({ error: 'This post changed. Refresh the page to review the latest version.' }, 409);
                case 'idempotency_conflict':
                    return json({ error: 'This feedback was already saved. Refresh the page and try again.' }, 409);
                case 'invalid_request':
                    return json({ error: 'Enter your name and add a comment for changes or comments.' }, 400);
                case 'rate_limited':
                    return json({ error: 'This review link has reached its hourly feedback limit. Try again later.' }, 429);
                default:
                    return unavailable();
            }
        } catch {
            return unavailable();
        }
    };
}

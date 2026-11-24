export const UNAVAILABLE_REVIEW = "This link isn't available.";

export const RETRY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_.-]{7,199}$/;

export type ReviewDecision = 'approved' | 'changes_requested' | null;

export interface InternalFeedback {
    reviewerName: string;
    decision: ReviewDecision;
    comment: string | null;
    photoPosition?: number | null;
}

export interface StaffInternalFeedback extends InternalFeedback {
    id: string;
    versionNo: number | null;
    photoUrl?: string | null;
}

export interface InternalReviewPost {
    itemId: string;
    versionId: string;
    position: number;
    title: string;
    body: string;
    postType: string;
    scheduledDate: string;
    offerStart: string | null;
    offerEnd: string | null;
    terms: string;
    ctaUrl: string | null;
    ctaLabel: string;
    photoSrc: string | null;
    photoSrcs?: (string | null)[];
    feedback: InternalFeedback[];
}

export interface InternalReviewView {
    clientName: string;
    batches: { title: string; posts: InternalReviewPost[] }[];
}

export const reviewDecisions = {
    approved: 'Approve',
    changes_requested: 'Needs changes',
    comment: 'Comment',
} as const;

export function feedbackLabel(decision: ReviewDecision) {
    return decision === 'approved' ? 'Approved' : reviewDecisions[decision ?? 'comment'];
}

export function webUrl(value: string | null): string | null {
    if (!value || !/^https?:\/\/\S+$/i.test(value)) return null;
    try {
        const url = new URL(value);
        return url.username || url.password ? null : url.href;
    } catch {
        return null;
    }
}

export function publicInternalReviewPath(pathname: string): boolean {
    return /^\/ir\/[^/]+$/.test(pathname) || /^\/api\/public\/internal-review\/[^/]+(?:\/feedback)?$/.test(pathname);
}

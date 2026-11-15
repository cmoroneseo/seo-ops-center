import { PUBLIC_REVIEW_HEADERS } from '@/lib/gbp-approvals/public-view';
import { loadApprovalReview } from '@/lib/approvals-v2/public';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
    try {
        const view = await loadApprovalReview((await context.params).token);
        return Response.json(view ?? { error: 'Review not found.' }, { status: view ? 200 : 404, headers: PUBLIC_REVIEW_HEADERS });
    } catch {
        return Response.json({ error: 'Review not found.' }, { status: 404, headers: PUBLIC_REVIEW_HEADERS });
    }
}

export async function POST() {
    return Response.json({ error: 'Send the review to the submit route.' }, { status: 405, headers: PUBLIC_REVIEW_HEADERS });
}

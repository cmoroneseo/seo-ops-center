import { PUBLIC_REVIEW_HEADERS } from '@/lib/gbp-approvals/public-view';
import { createPublicGet } from '@/lib/gbp-approvals/public-get-route';
import { loadPublicReview, signApprovalPhoto } from '@/lib/gbp-approvals/live';

export const dynamic = 'force-dynamic';
export const GET = createPublicGet({ loadPublicReview, signApprovalPhoto });

export async function POST() {
    return Response.json({ error: 'Send the review to the submit route.' }, { status: 405, headers: PUBLIC_REVIEW_HEADERS });
}

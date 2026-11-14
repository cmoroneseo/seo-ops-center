import { loadPublicReview, signApprovalPhoto } from '@/lib/gbp-approvals/live';
import { PUBLIC_REVIEW_HEADERS, publicMessage, publicStatus } from '@/lib/gbp-approvals/public-view';

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: PUBLIC_REVIEW_HEADERS });
}

export function createPublicGet(dependencies: { loadPublicReview: typeof loadPublicReview; signApprovalPhoto: typeof signApprovalPhoto }) {
    const { loadPublicReview, signApprovalPhoto } = dependencies;
    return async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
        const { token } = await context.params;
        if (!token || token.length < 20) return json({ error: publicMessage('not_found') }, 404);
        try {
            const view = await loadPublicReview(token, signApprovalPhoto);
            if (!view) return json({ error: publicMessage('not_found') }, 404);
            if ('code' in view) return json({ error: publicMessage(view.code) }, publicStatus(view.code));
            return json(view);
        } catch {
            return json({ error: publicMessage('not_found') }, 404);
        }
    };

}

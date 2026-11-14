import type { Metadata } from 'next';

import { PublicReview } from '@/components/gbp-approvals/PublicReview';
import { loadPublicReview, signApprovalPhoto } from '@/lib/gbp-approvals/live';
import type { PublicReviewView } from '@/lib/gbp-approvals/public-view';
import type { SamplePost } from '@/components/gbp-approvals/sample';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Review your Google posts',
    robots: { index: false, follow: false },
};

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    let view: PublicReviewView | { code: string } | null = null;
    try {
        view = await loadPublicReview(token, signApprovalPhoto);
    } catch {
        view = null;
    }
    if (!view || 'code' in view) {
        return <PublicReview mode="missing" posts={[]} questions={[]} />;
    }
    const posts: SamplePost[] = view.posts.map(post => ({
        position: post.position,
        title: post.title,
        scheduled: post.scheduledDate,
        offerStart: post.offerStart ?? post.scheduledDate,
        offerEnd: post.offerEnd ?? post.scheduledDate,
        body: post.body,
        photo: post.photoSrc,
        status: post.status === 'pending' ? 'pending' : post.status,
        comment: post.decision?.comment ?? undefined,
        suggestedBody: post.decision?.suggestedBody ?? undefined,
        previousBody: post.previous?.body,
    }));
    const mode = view.state === 'active'
        ? (view.round > 1 ? 'revision' : 'review')
        : view.state === 'expired' ? 'expired' : 'revoked';
    return (
        <PublicReview
            mode={mode}
            posts={posts}
            clientName={view.clientName}
            questions={view.questions.map(question => ({
                id: question.id,
                prompt: question.prompt,
                about: question.itemId ? 'This post' : 'Whole request',
                answer: question.answer,
            }))}
        />
    );
}

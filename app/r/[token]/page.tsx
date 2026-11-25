import { PublicPageReview } from '@/components/approvals-v2/PublicPageReview';
import { loadApprovalReview } from '@/lib/approvals-v2/public';
import type { Metadata } from 'next';

import { PublicReview, type ReviewPost } from '@/components/gbp-approvals/PublicReview';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
    const view = await loadApprovalReview((await params).token).catch(() => null);
    return { title: view && 'itemType' in view ? 'Review your page' : 'Review your Google posts', robots: { index: false, follow: false } };
}

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    let view: Awaited<ReturnType<typeof loadApprovalReview>> = null;
    try {
        view = await loadApprovalReview(token);
    } catch {
        view = null;
    }
    if (!view || 'code' in view) {
        return <PublicReview mode="missing" posts={[]} questions={[]} />;
    }
    if ('itemType' in view) return <PublicPageReview token={token} view={view} />;
    const posts: ReviewPost[] = view.posts.map(post => ({
        itemId: post.id,
        versionId: post.versionId,
        locked: post.locked,
        terms: post.terms,
        postType: post.postType,
        ctaUrl: post.ctaUrl,
        ctaLabel: post.ctaLabel,
        changeNote: post.changeNote,
        position: post.position,
        title: post.title,
        scheduled: post.scheduledDate,
        offerStart: post.offerStart,
        offerEnd: post.offerEnd,
        body: post.body,
        photo: post.photoSrc,
        photoSrcs: post.photoSrcs,
        videoSrc: post.videoSrc,
        videoPosterSrc: post.videoPosterSrc,
        photoComments: post.comments,
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
            token={token}
            expiresAt={view.expiresAt}
            dueAt={view.dueAt}
            mode={mode}
            posts={posts}
            clientName={view.state === 'active' ? view.clientName : undefined}
            logoSrc={view.state === 'active' ? view.clientLogoUrl ?? undefined : undefined}
            questions={view.questions.map(question => ({
                id: question.id,
                prompt: question.prompt,
                about: question.itemId ? 'This post' : 'Whole request',
                answer: question.answer,
            }))}
        />
    );
}

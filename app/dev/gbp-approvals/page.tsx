import { AgencyStatus } from '@/components/gbp-approvals/AgencyStatus';
import { PublicReview } from '@/components/gbp-approvals/PublicReview';
import { SAMPLE_POSTS } from '@/components/gbp-approvals/sample';

export const dynamic = 'force-dynamic';

export default async function DevApprovalsPage({ searchParams }: { searchParams: Promise<{ screen?: string }> }) {
    const { screen = 'review' } = await searchParams;
    if (screen === 'status') return <AgencyStatus />;
    if (screen === 'revision') return <PublicReview mode="revision" posts={SAMPLE_POSTS} />;
    if (screen === 'expired') return <PublicReview mode="expired" posts={SAMPLE_POSTS} />;
    if (screen === 'revoked') return <PublicReview mode="revoked" posts={SAMPLE_POSTS} />;
    const fresh = SAMPLE_POSTS.map(post => ({ ...post, status: 'pending' as const, comment: undefined, previousBody: undefined, replacementPhoto: undefined }));
    return <PublicReview mode="review" posts={fresh} />;
}

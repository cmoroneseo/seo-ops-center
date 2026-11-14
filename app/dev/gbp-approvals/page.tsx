import { AgencyStatus } from '@/components/gbp-approvals/AgencyStatus';
import { PublicReview } from '@/components/gbp-approvals/PublicReview';
import { LOGO, SAMPLE_POSTS, SAMPLE_QUESTIONS } from '@/components/gbp-approvals/sample';

const sample = { clientName: 'ALL-IN-1 Construction', logoSrc: LOGO, questions: SAMPLE_QUESTIONS };

export const dynamic = 'force-dynamic';

export default async function DevApprovalsPage({ searchParams }: { searchParams: Promise<{ screen?: string }> }) {
    const { screen = 'review' } = await searchParams;
    if (screen === 'status') return <AgencyStatus />;
    if (screen === 'revision') return <PublicReview {...sample} mode="revision" posts={SAMPLE_POSTS} />;
    if (screen === 'expired') return <PublicReview {...sample} mode="expired" posts={SAMPLE_POSTS} />;
    if (screen === 'revoked') return <PublicReview {...sample} mode="revoked" posts={SAMPLE_POSTS} />;
    const fresh = SAMPLE_POSTS.map(post => ({ ...post, status: 'pending' as const, comment: undefined, previousBody: undefined, replacementPhoto: undefined }));
    return <PublicReview {...sample} mode="review" posts={fresh} />;
}

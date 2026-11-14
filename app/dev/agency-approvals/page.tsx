import { AgencyPreviewShell } from '@/components/gbp-approvals/AgencyPreviewShell';
import type { AgencyView } from '@/components/gbp-approvals/AgencyStatus';

export const dynamic = 'force-dynamic';

const VIEWS = new Set<AgencyView>(['status', 'share', 'revision', 'history']);

export default async function AgencyApprovalsPreview({ searchParams }: { searchParams: Promise<{ screen?: string }> }) {
    const { screen = 'status' } = await searchParams;
    const view: AgencyView = VIEWS.has(screen as AgencyView) ? screen as AgencyView : 'status';
    return <AgencyPreviewShell view={view} />;
}

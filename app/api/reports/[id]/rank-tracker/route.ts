import { NextRequest } from 'next/server';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';
import { requireReportAccess } from '@/lib/reports/access';
import { createRankTrackerHandler } from '@/lib/reports/rank-tracker-route';
import { getReport } from '@/lib/reports/reportStore';
import { fetchAhrefsRankTracker } from '@/lib/sync/fetchAhrefsRankTracker';

const handler = createRankTrackerHandler({
    access: (id, mode) => requireReportAccess(id, mode, { getReport, requireOrganizationMember }),
    fetchAhrefsRankTracker,
    now: () => new Date(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return handler.GET(id, req);
}

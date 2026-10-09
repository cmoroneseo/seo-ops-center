import { NextRequest } from 'next/server';
import { createMetricsHandlers } from '@/lib/metrics/metrics-route';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { deleteManualMetric, getClientMetrics, writeMetric } from '@/lib/sync/upsertMetric';

const handlers = createMetricsHandlers({
    requireClientOrgMember,
    getClientMetrics,
    writeMetric,
    deleteManualMetric,
    now: () => new Date(),
});

export async function GET(req: NextRequest) {
    return handlers.list(req);
}

export async function POST(req: NextRequest) {
    return handlers.create(req);
}

export async function DELETE(req: NextRequest) {
    return handlers.remove(req);
}

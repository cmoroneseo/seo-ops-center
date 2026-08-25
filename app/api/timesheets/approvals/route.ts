import { createApprovalPost } from '@/lib/timesheets/approval-route';
import { approvalDependencies } from '@/lib/timesheets/approval-wiring';

export const dynamic = 'force-dynamic';

/**
 * POST /api/timesheets/approvals
 * Body: { action: 'approve' | 'reopen', organizationId, clientId, month, note? }
 *
 * Approving freezes a snapshot of the eligible rows and writes a client
 * activity event. Reopening writes another event and leaves the prior snapshot
 * exactly as it was.
 */
export const POST = createApprovalPost(approvalDependencies);

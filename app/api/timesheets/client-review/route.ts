import { createClientReviewGet } from '@/lib/timesheets/approval-route';
import { approvalDependencies } from '@/lib/timesheets/approval-wiring';

export const dynamic = 'force-dynamic';

/**
 * GET /api/timesheets/client-review?organizationId=&clientId=&month=YYYY-MM
 *
 * The client-month read model: budget, eligible/non-budget totals, teammate
 * breakdown, exceptions, and the current approval plus any drift since it.
 * Manager-only.
 */
export const GET = createClientReviewGet(approvalDependencies);

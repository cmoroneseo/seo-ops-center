import { requireOrganizationMember } from '@/lib/security/tenant-authz';
import { requireReportAccess } from '@/lib/reports/access';
import { createReviewHandlers } from '@/lib/reports/review-route';
import { getReport } from '@/lib/reports/reportStore';
import { loadFrozenLedger, loadReviewContext, persistReview, readVersionSnapshot } from '@/lib/reports/version-store';

export const reviewHandlers = createReviewHandlers({
    access: (id, mode) => requireReportAccess(id, mode, { getReport, requireOrganizationMember }),
    loadContext: loadReviewContext,
    loadLedger: loadFrozenLedger,
    persist: persistReview,
    readSnapshot: readVersionSnapshot,
    now: () => new Date(),
});

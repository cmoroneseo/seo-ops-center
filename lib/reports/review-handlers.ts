import { requireOrganizationMember } from '@/lib/security/tenant-authz';
import { requireReportAccess } from '@/lib/reports/access';
import { checklistPlan } from '@/lib/portal/progress';
import { capturePlan } from '@/lib/portal/publication';
import { createReviewHandlers } from '@/lib/reports/review-route';
import { getReport } from '@/lib/reports/reportStore';
import { loadFrozenLedger, loadReviewContext, persistReview, readVersionSnapshot } from '@/lib/reports/version-store';

export const reviewHandlers = createReviewHandlers({
    access: (id, mode) => requireReportAccess(id, mode, { getReport, requireOrganizationMember }),
    loadContext: loadReviewContext,
    loadLedger: loadFrozenLedger,
    loadPlan: async (organizationId, clientId) => {
        const plan = await capturePlan({ organizationId, clientId });
        return plan ? { plan: checklistPlan({ ...plan, organizationId, clientId }) } : null;
    },
    persist: persistReview,
    readSnapshot: readVersionSnapshot,
    now: () => new Date(),
});

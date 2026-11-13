import { createForecastPushPost, forecastPushViewerRejection } from '@/lib/forecast/push';
import { scheduleLiveForecastPush } from '@/lib/forecast/live-push';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

/** POST /api/forecast/push — member nudge after a task, event, or time entry changes. */
export const POST = createForecastPushPost({
    now: () => new Date(),
    async authorize(organizationId) {
        const result = await requireOrganizationMember(organizationId);
        if (!result.ok) return result;
        const viewer = forecastPushViewerRejection(result.role);
        if (viewer) return viewer;
        return {
            ok: true,
            userId: result.userId,
            actorName: result.actorName,
            organizationId: result.organizationId,
        };
    },
    schedule: scheduleLiveForecastPush,
});

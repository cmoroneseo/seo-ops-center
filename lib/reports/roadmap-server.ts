/**
 * Server read for the live roadmap on a shared client report.
 * The service-role client stays in this file. The browser never sees it.
 */

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadClientPlanBoard, loadClientStageTasks } from '@/lib/seo-plan/stage-list-load';
import { todayForRoadmap, type ClientRoadmap } from './roadmap';
import { readSharedReportRoadmap, type ShareRead } from './roadmap-live';

/**
 * Live roadmap for one report the portal has already shared.
 * Sections are the frozen share the page is rendering, not the editable draft.
 * The active share for this organization, client, and report is the permission.
 * A failed lookup, a missing share, a missing block, or a failed task read
 * returns null. Hidden stages and descriptions are removed before return.
 */
export async function loadScopedRoadmap(
    organizationId: string,
    clientId: string,
    reportId: string,
    sections: unknown,
): Promise<ClientRoadmap | null> {
    try {
        const admin = createAdminClient();
        const share = await admin.from('client_portal_report_shares')
            .select('id')
            .eq('report_id', reportId)
            .eq('organization_id', organizationId)
            .eq('client_id', clientId)
            .is('unshared_at', null)
            .maybeSingle();
        const access: ShareRead = share.error ? 'error' : share.data ? 'ok' : 'missing';
        return await readSharedReportRoadmap({
            organizationId,
            clientId,
            reportId,
            sections,
            share: access,
        }, {
            today: todayForRoadmap(),
            loadTasks: (org, scopedClient) => loadClientStageTasks(admin, org, scopedClient),
            loadBoard: (org, scopedClient) => loadClientPlanBoard(admin, org, scopedClient),
        });
    } catch {
        return null;
    }
}

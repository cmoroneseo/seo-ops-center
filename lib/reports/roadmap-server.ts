/**
 * Server read for the live roadmap on an approved client report.
 * The service-role client stays in this file. The browser never sees it.
 */

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadClientPlanBoard, loadClientStageTasks } from '@/lib/seo-plan/stage-list-load';
import { blocksForClientRender, type ReportSectionsField } from './blocks';
import { todayForRoadmap, type ClientRoadmap } from './roadmap';
import { readApprovedReportRoadmap } from './roadmap-live';

function blockPropsFromSections(sections: unknown): unknown | null {
    const blocks = blocksForClientRender(sections as ReportSectionsField);
    const block = blocks.find(item => item.type === 'roadmap');
    return block ? block.props : null;
}

/**
 * Live roadmap for one report the server has already scoped to an organization
 * and client. The report's own state and Roadmap block settings are read here.
 * A database error, a missing report, or a report with no Roadmap block
 * returns null. Hidden stages and descriptions are removed before return.
 */
export async function loadScopedRoadmap(
    organizationId: string,
    clientId: string,
    reportId: string,
): Promise<ClientRoadmap | null> {
    try {
        const admin = createAdminClient();
        const [review, report] = await Promise.all([
            admin.from('report_reviews')
                .select('state')
                .eq('report_id', reportId)
                .eq('organization_id', organizationId)
                .eq('client_id', clientId)
                .maybeSingle(),
            admin.from('reports')
                .select('sections')
                .eq('id', reportId)
                .eq('organization_id', organizationId)
                .eq('client_id', clientId)
                .maybeSingle(),
        ]);
        if (review.error || report.error || !review.data || !report.data) return null;
        return await readApprovedReportRoadmap({
            state: typeof review.data.state === 'string' ? review.data.state : '',
            organizationId,
            clientId,
            snapshot: null,
            blockProps: blockPropsFromSections(report.data.sections),
        }, {
            today: todayForRoadmap(),
            loadTasks: (org, scopedClient) => loadClientStageTasks(admin, org, scopedClient),
            loadBoard: (org, scopedClient) => loadClientPlanBoard(admin, org, scopedClient),
        });
    } catch {
        return null;
    }
}

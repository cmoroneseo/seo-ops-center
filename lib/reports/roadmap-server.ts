/**
 * Server reads for the live roadmap.
 * The service-role client is used here only. The browser never sees it,
 * and this file does not add a public policy on tasks.
 * A public link supplies its own organization and client. Nothing else does.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { loadClientPlanBoard, loadClientStageTasks } from '@/lib/seo-plan/stage-list-load';
import { blocksForClientRender, type ReportSectionsField } from './blocks';
import { todayForRoadmap } from './roadmap';
import { readApprovedReportRoadmap, readPublicRoadmap, type PublicReportLink } from './roadmap-live';

function propsForReport(sections: unknown): unknown {
    const blocks = blocksForClientRender(sections as ReportSectionsField);
    const block = blocks.find(item => item.type === 'roadmap');
    return block ? block.props : null;
}

export async function loadPublicRoadmap(token: string) {
    const admin = createAdminClient();
    return readPublicRoadmap(token, {
        now: () => new Date(),
        today: todayForRoadmap(),
        findLink: async hash => {
            const { data, error } = await admin.from('report_public_links')
                .select('token_hash, revoked_at, expires_at, organization_id, client_id, report_id')
                .eq('token_hash', hash)
                .maybeSingle();
            if (error || !data) return null;
            const row: PublicReportLink = {
                tokenHash: String(data.token_hash),
                revokedAt: data.revoked_at ? String(data.revoked_at) : null,
                expiresAt: data.expires_at ? String(data.expires_at) : null,
                organizationId: String(data.organization_id),
                clientId: String(data.client_id),
                reportId: String(data.report_id),
            };
            return row;
        },
        loadTasks: (organizationId, clientId) => loadClientStageTasks(admin, organizationId, clientId),
        loadBoard: (organizationId, clientId) => loadClientPlanBoard(admin, organizationId, clientId),
        loadBlockProps: async (organizationId, clientId, reportId) => {
            const { data, error } = await admin.from('reports')
                .select('sections')
                .eq('id', reportId)
                .eq('organization_id', organizationId)
                .eq('client_id', clientId)
                .maybeSingle();
            if (error || !data) return {};
            return propsForReport(data.sections);
        },
    });
}

/** An approved report the server has already scoped to one organization and client. */
export async function loadScopedRoadmap(organizationId: string, clientId: string) {
    try {
        const admin = createAdminClient();
        return await readApprovedReportRoadmap({
            state: 'approved',
            organizationId,
            clientId,
            snapshot: null,
        }, {
            today: todayForRoadmap(),
            loadTasks: (org, client) => loadClientStageTasks(admin, org, client),
            loadBoard: (org, client) => loadClientPlanBoard(admin, org, client),
        });
    } catch {
        return null;
    }
}

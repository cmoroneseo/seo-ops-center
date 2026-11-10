/**
 * Server read for the live roadmap on a shared client report.
 * The service-role client stays in this file. The browser never sees it.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { findPublicShareByHash } from './gtm-share-store';
import { loadClientPlanBoard, loadClientStageTasks } from '@/lib/seo-plan/stage-list-load';
import { todayForRoadmap, type ClientRoadmap } from './roadmap';
import { readSharedReportRoadmap, type ShareRead } from './roadmap-live';
import {
    readPublicRoadmap,
    type PublicRoadmapResult,
    type PublicRoadmapScope,
    type RoadmapShareSources,
} from './roadmap-public';

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

const APPROVED = new Set(['approved', 'scheduled', 'sent']);

/**
 * Latest approved version and the active portal share for one report.
 * Ids are the ones on the public link. A failed query is an error, not an
 * empty plan, so the caller can refuse the page.
 */
export async function loadRoadmapShareSources(
    db: SupabaseClient,
    scope: PublicRoadmapScope,
): Promise<RoadmapShareSources> {
    const [share, review] = await Promise.all([
        db.from('client_portal_report_shares')
            .select('snapshot')
            .eq('report_id', scope.reportId)
            .eq('organization_id', scope.organizationId)
            .eq('client_id', scope.clientId)
            .is('unshared_at', null)
            .maybeSingle(),
        db.from('report_reviews')
            .select('state, current_version_id')
            .eq('report_id', scope.reportId)
            .eq('organization_id', scope.organizationId)
            .eq('client_id', scope.clientId)
            .maybeSingle(),
    ]);
    if (share.error || review.error) return { share: 'error', frozen: 'error' };

    const shareSource: RoadmapShareSources['share'] = share.data?.snapshot ? share.data.snapshot : 'missing';
    const state = typeof review.data?.state === 'string' ? review.data.state : '';
    const versionId = typeof review.data?.current_version_id === 'string' ? review.data.current_version_id : '';
    if (!versionId || !APPROVED.has(state)) return { share: shareSource, frozen: 'missing' };

    const version = await db.from('report_versions')
        .select('snapshot')
        .eq('id', versionId)
        .eq('report_id', scope.reportId)
        .eq('organization_id', scope.organizationId)
        .maybeSingle();
    if (version.error || !version.data?.snapshot || typeof version.data.snapshot !== 'object') {
        return { share: shareSource, frozen: 'error' };
    }
    return {
        share: shareSource,
        frozen: { snapshot: version.data.snapshot, versionId },
    };
}

/**
 * Live plan for a roadmap link. The service-role client stays in this file.
 * A bad token or a failed read is a denial, never another client's plan.
 */
export async function openScopedPublicRoadmap(token: string): Promise<PublicRoadmapResult> {
    try {
        const admin = createAdminClient();
        return await readPublicRoadmap(token, {
            today: todayForRoadmap(),
            findByHash: findPublicShareByHash,
            loadSources: scope => loadRoadmapShareSources(admin, scope),
            loadTasks: (organizationId, clientId) => loadClientStageTasks(admin, organizationId, clientId),
            loadBoard: (organizationId, clientId) => loadClientPlanBoard(admin, organizationId, clientId),
        });
    } catch {
        return { ok: false, denial: 'not_found' };
    }
}

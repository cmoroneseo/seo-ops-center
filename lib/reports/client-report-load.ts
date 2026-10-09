/**
 * Portal reads of a frozen client report. The contact's organization and
 * client come from the session, never from the page URL.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/portal/access-policy';
import { loadPortalReport, loadPortalReports } from '@/lib/portal/data';
import type { PortalClientScope } from '@/lib/portal/session';
import { clientReportFromSnapshot, forAudience, snapshotMatchesScope, type ClientReportModel } from './render-model';

const CLIENT_VISIBLE = new Set(['approved', 'scheduled', 'sent']);

export async function loadFrozenClientSnapshot(contact: Pick<PortalClientScope, 'organizationId' | 'clientId'>, reportId: string): Promise<unknown | null> {
    if (!isUuid(reportId)) return null;
    const admin = createAdminClient();
    const review = await admin.from('report_reviews')
        .select('state, current_version_id')
        .eq('report_id', reportId)
        .eq('organization_id', contact.organizationId)
        .eq('client_id', contact.clientId)
        .maybeSingle();
    if (review.error) {
        if (review.error.code === '42P01') return null;
        throw new Error('Could not load the report');
    }
    const versionId = typeof review.data?.current_version_id === 'string' ? review.data.current_version_id : null;
    if (!versionId || !CLIENT_VISIBLE.has(String(review.data?.state))) return null;
    const version = await admin.from('report_versions')
        .select('snapshot')
        .eq('id', versionId)
        .eq('report_id', reportId)
        .eq('organization_id', contact.organizationId)
        .eq('client_id', contact.clientId)
        .maybeSingle();
    if (version.error) throw new Error('Could not load the report');
    const snapshot = version.data?.snapshot;
    if (!snapshot || typeof snapshot !== 'object') return null;
    if (!snapshotMatchesScope(snapshot, contact.organizationId, contact.clientId)) return null;
    return snapshot;
}

/** Shared reports only. AM-only copy is removed before the model leaves the server. */
export async function loadClientReportModel(contact: PortalClientScope, reportId: string): Promise<ClientReportModel | null> {
    const shared = await loadPortalReport(contact, reportId);
    if (!shared) return null;
    const snapshot = await loadFrozenClientSnapshot(contact, reportId);
    if (!snapshot) return null;
    const reports = await loadPortalReports(contact);
    const model = clientReportFromSnapshot(snapshot, {
        reports: reports.map(report => ({ month: report.reportMonth, reportId: report.id })),
    });
    return model ? forAudience(model, 'client') : null;
}

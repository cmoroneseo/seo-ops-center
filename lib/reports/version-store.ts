import { createAdminClient } from '@/lib/supabase/admin';
import { buildLedger } from '@/lib/search-reporting/ledger';
import { loadLedger } from '@/lib/search-reporting/ledger-load';
import { isMissingProof, normalizeShipDate } from '@/lib/search-reporting/proof';
import { monthBounds } from '@/lib/sync/months';
import type { ReportRow } from './reportStore';
import { instantAtPt } from './business-days';
import type { PersistInput, ReviewContext, VersionListItem } from './review-route';
import { gscMonthReadout, type FrozenLedgerRow, type GscDayInput, type MetricInput, type ReportVersionSnapshot } from './versions';
import { emptyReview, type ReviewRecord, type ReviewState } from './workflow';
import type { PortalReportDetail } from '@/lib/portal/data';

type DbError = { code?: string } | null;
type StoreResult<T> = { ok: true; context: T } | { ok: false; status: number; error: string };

const SOURCES = ['gsc', 'ga4', 'gbp', 'ahrefs'] as const;

function failure(error: DbError, fallback: string): { ok: false; status: number; error: string } {
    if (error?.code === '42P01' || error?.code === '42883') {
        return { ok: false, status: 503, error: 'Report reviews are not available yet.' };
    }
    if (error?.code === '23505') return { ok: false, status: 409, error: 'This report was just updated. Reload and try again.' };
    if (error?.code === '23514' || error?.code === '55000') return { ok: false, status: 409, error: 'That review change is not allowed.' };
    return { ok: false, status: 500, error: fallback };
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function reviewFrom(row: Record<string, unknown> | null): ReviewRecord {
    if (!row) return emptyReview();
    const state = row.state;
    return {
        exists: true,
        state: state === 'ready_for_review' || state === 'approved' || state === 'scheduled' || state === 'sent' ? state : 'draft',
        requiresOwnerApproval: row.requires_owner_approval === true,
        amApprovedBy: text(row.am_approved_by),
        ownerApprovedBy: text(row.owner_approved_by),
        currentVersionId: text(row.current_version_id),
        recipientContactId: text(row.recipient_contact_id),
        scheduledFor: text(row.scheduled_for),
        sentAt: text(row.sent_at),
    };
}

function metricFrom(row: Record<string, unknown>): MetricInput {
    const data = row.data && typeof row.data === 'object' && !Array.isArray(row.data)
        ? row.data as Record<string, unknown>
        : {};
    return {
        source: String(row.source ?? ''),
        metricMonth: String(row.metric_month ?? ''),
        data,
        provenance: row.provenance ?? null,
        sourceType: text(row.source_type),
        updatedAt: text(row.updated_at),
    };
}

function count(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) return Number(value);
    return null;
}

function nextDate(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + 1);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export async function loadFrozenLedger(organizationId: string, clientId: string, now: Date): Promise<FrozenLedgerRow[]> {
    const source = await loadLedger({ organizationId, clientId, now });
    return buildLedger(source, now).entries.map(entry => ({
        id: entry.id,
        title: entry.title,
        shippedOn: entry.shippedOn,
        publishedUrl: entry.publishedUrl,
        verdict: entry.verdict,
        chip: entry.chip,
        detail: entry.detail,
        footnote: entry.footnote,
    }));
}

export async function loadReviewContext(report: ReportRow): Promise<StoreResult<ReviewContext>> {
    if (!report.client_id) return { ok: false, status: 409, error: 'Assign a client before approving.' };
    const admin = createAdminClient();
    const organizationId = report.organization_id;
    const clientId = report.client_id;
    const bounds = monthBounds(report.report_month);

    const [clientResult, countResult, reviewResult, versionResult, contactResult, integrationResult, metricResult, timeResult, taskResult, deliverableResult] = await Promise.all([
        admin.from('clients').select('created_at').eq('id', clientId).eq('organization_id', organizationId).maybeSingle(),
        admin.from('reports').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('organization_id', organizationId),
        admin.from('report_reviews').select('state, requires_owner_approval, current_version_id, am_approved_by, owner_approved_by, recipient_contact_id, scheduled_for, sent_at').eq('report_id', report.id).eq('organization_id', organizationId).maybeSingle(),
        admin.from('report_versions').select('id, version_no, reason, correction_note, am_note, content_hash, created_at, created_by').eq('report_id', report.id).eq('organization_id', organizationId).order('version_no', { ascending: true }),
        admin.from('client_portal_contacts').select('id').eq('client_id', clientId).eq('organization_id', organizationId).is('revoked_at', null).order('created_at', { ascending: true }).limit(1),
        admin.from('client_integrations').select('service, sync_status, last_synced_at, site_url:credentials->>site_url').eq('client_id', clientId).eq('organization_id', organizationId).in('service', [...SOURCES]),
        admin.from('metrics').select('source, metric_month, data, provenance, source_type, updated_at').eq('client_id', clientId).eq('organization_id', organizationId),
        admin.from('time_logs').select('hours').eq('client_id', clientId).eq('organization_id', organizationId).eq('status', 'logged').eq('import_status', 'mapped').is('voided_at', null).gte('date', bounds.start).lte('date', bounds.end),
        admin.from('tasks').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('organization_id', organizationId).eq('status', 'done').gte('completed_at', instantAtPt(bounds.start, 0, 0).toISOString()).lt('completed_at', instantAtPt(nextDate(bounds.end), 0, 0).toISOString()),
        admin.from('deliverables').select('status, published_url, delivered_on').eq('client_id', clientId).eq('organization_id', organizationId).eq('status', 'Published'),
    ]);

    if (clientResult.error) return failure(clientResult.error, 'Could not load the review.');
    if (!clientResult.data) return { ok: false, status: 404, error: 'Not found' };
    for (const result of [countResult, reviewResult, versionResult, contactResult, integrationResult, metricResult]) {
        if (result.error) return failure(result.error, 'Could not load the review.');
    }
    if (timeResult.error || taskResult.error || deliverableResult.error) {
        return failure(timeResult.error ?? taskResult.error ?? deliverableResult.error, 'Could not read recorded work.');
    }

    const integrations = new Map<string, { sync_status?: string | null; last_synced_at?: string | null; site_url?: string | null }>();
    for (const row of integrationResult.data ?? []) {
        const service = String((row as { service?: string }).service ?? '');
        if (!integrations.has(service)) integrations.set(service, row as { sync_status?: string | null; last_synced_at?: string | null; site_url?: string | null });
    }
    const sources = SOURCES.map(source => {
        const row = integrations.get(source);
        const status = row?.sync_status ?? null;
        return {
            source,
            connected: status === 'active' || status === 'error',
            errored: status === 'error',
            lastSyncedAt: text(row?.last_synced_at),
        };
    });
    const gsc = sources.find(source => source.source === 'gsc');
    const property = text(integrations.get('gsc')?.site_url);
    let gscDays: GscDayInput[] = [];
    if (gsc?.connected && property) {
        const days = await admin.from('gsc_history_days')
            .select('id, data_date, is_incomplete')
            .eq('organization_id', organizationId)
            .eq('client_id', clientId)
            .eq('property', property)
            .eq('search_type', 'web')
            .gte('data_date', bounds.start)
            .lte('data_date', bounds.end);
        if (days.error) return failure(days.error, 'Could not read Search Console history.');
        const ids = (days.data ?? []).map(day => String(day.id));
        const facts = ids.length === 0 ? { data: [], error: null } : await admin.from('gsc_history_facts')
            .select('day_id, clicks, impressions')
            .in('day_id', ids)
            .eq('grain', 'property');
        if (facts.error) return failure(facts.error, 'Could not read Search Console history.');
        const byDay = new Map<string, { clicks: number; impressions: number }>();
        for (const fact of facts.data ?? []) {
            const clicks = count((fact as { clicks?: unknown }).clicks);
            const impressions = count((fact as { impressions?: unknown }).impressions);
            if (clicks == null || impressions == null) return { ok: false, status: 500, error: 'Could not read Search Console history.' };
            byDay.set(String((fact as { day_id?: unknown }).day_id), { clicks, impressions });
        }
        gscDays = (days.data ?? []).map(day => ({
            date: String(day.data_date).slice(0, 10),
            isIncomplete: day.is_incomplete === true,
            property: byDay.get(String(day.id)) ?? { clicks: 0, impressions: 0 },
        }));
    }

    const readout = gscMonthReadout(report.report_month, gscDays);
    let hours = 0;
    for (const row of timeResult.data ?? []) {
        const value = count((row as { hours?: unknown }).hours);
        if (value == null) return { ok: false, status: 500, error: 'Could not read recorded work.' };
        if (value > 0) hours += value;
    }
    const deliverables = deliverableResult.data ?? [];
    let missingProofCount = 0;
    let shipped = 0;
    for (const row of deliverables) {
        const publishedUrl = text((row as { published_url?: unknown }).published_url);
        const deliveredOn = text((row as { delivered_on?: unknown }).delivered_on);
        if (isMissingProof({ status: 'Published', publishedUrl, deliveredOn })) {
            missingProofCount += 1;
            continue;
        }
        const shippedOn = normalizeShipDate(deliveredOn);
        if (shippedOn?.slice(0, 7) === report.report_month) shipped += 1;
    }
    const contactId = text((contactResult.data ?? [])[0]?.id);
    const versions: VersionListItem[] = (versionResult.data ?? []).map(row => ({
        id: String(row.id),
        versionNo: Number(row.version_no),
        reason: row.reason === 'correction' ? 'correction' : 'approval',
        correctionNote: text(row.correction_note),
        amNote: text(row.am_note),
        contentHash: String(row.content_hash),
        createdAt: String(row.created_at),
        createdBy: text(row.created_by),
    }));

    return {
        ok: true,
        context: {
            clientCreatedAt: text(clientResult.data.created_at),
            reportCount: countResult.count ?? 0,
            review: reviewFrom(reviewResult.data as Record<string, unknown> | null),
            hasRecipient: Boolean(contactId),
            recipientContactId: contactId,
            sources,
            gsc: {
                connected: Boolean(gsc?.connected),
                final: Boolean(gsc?.connected) && readout.final,
                clicks: gsc?.connected ? readout.clicks : null,
                impressions: gsc?.connected ? readout.impressions : null,
                lastSyncedAt: gsc?.lastSyncedAt ?? null,
                errored: Boolean(gsc?.errored),
            },
            gscDays,
            hours,
            tasksCompleted: taskResult.count ?? 0,
            shipped,
            missingProofCount,
            rankChecks: [],
            metrics: (metricResult.data ?? []).map(row => metricFrom(row as Record<string, unknown>)),
            versions,
        },
    };
}

export async function persistReview(input: PersistInput): Promise<{ ok: true; versionId: string | null } | { ok: false; status: number; error: string }> {
    const admin = createAdminClient();
    let versionId = input.plan.currentVersionId;
    if (input.plan.capture) {
        if (!input.snapshot || !input.contentHash || !input.plan.reason) {
            return { ok: false, status: 500, error: 'Could not freeze the report.' };
        }
        const latest = await admin.from('report_versions').select('version_no').eq('report_id', input.reportId).eq('organization_id', input.organizationId).order('version_no', { ascending: false }).limit(1).maybeSingle();
        if (latest.error) return failure(latest.error, 'Could not save the review.');
        const inserted = await admin.from('report_versions').insert({
            organization_id: input.organizationId,
            client_id: input.clientId,
            report_id: input.reportId,
            version_no: Number(latest.data?.version_no ?? 0) + 1,
            content_hash: input.contentHash,
            snapshot: input.snapshot,
            reason: input.plan.reason,
            correction_note: input.snapshot.correctionNote,
            am_note: input.snapshot.copy.whatWeDid,
            created_by: input.actorId,
        }).select('id').single();
        if (inserted.error || !inserted.data) return failure(inserted.error, 'Could not save the review.');
        versionId = String(inserted.data.id);
    }

    if (!input.fromExists) {
        const created = await admin.from('report_reviews').insert({
            organization_id: input.organizationId,
            client_id: input.clientId,
            report_id: input.reportId,
            state: 'draft',
            requires_owner_approval: input.plan.requiresOwnerApproval,
        }).select('id').single();
        if (created.error) return failure(created.error, 'Could not save the review.');
    }

    const from: ReviewState = input.fromExists ? input.fromState : 'draft';
    let expected: ReviewState = from;
    if (from === 'draft' && input.plan.toState !== 'draft') {
        const hop = await admin.from('report_reviews').update({
            state: 'ready_for_review',
            requires_owner_approval: input.plan.requiresOwnerApproval,
        }).eq('report_id', input.reportId).eq('organization_id', input.organizationId).eq('state', 'draft').select('id');
        if (hop.error) return failure(hop.error, 'Could not save the review.');
        if (!hop.data?.length) return { ok: false, status: 409, error: 'This report was just updated. Reload and try again.' };
        expected = 'ready_for_review';
    }

    const patch: Record<string, unknown> = {
        state: input.plan.toState,
        requires_owner_approval: input.plan.requiresOwnerApproval,
        current_version_id: versionId,
        am_approved_by: input.plan.amApprovedBy,
        owner_approved_by: input.plan.ownerApprovedBy,
        recipient_contact_id: input.plan.recipientContactId,
        scheduled_for: input.plan.scheduledFor,
        sent_at: input.plan.sentAt,
    };
    if (input.amNote) patch.am_note = input.amNote;
    if (input.plan.stampAm) patch.am_approved_at = input.now;
    if (input.plan.stampOwner) patch.owner_approved_at = input.now;
    if (!input.plan.amApprovedBy) patch.am_approved_at = null;
    if (!input.plan.ownerApprovedBy) patch.owner_approved_at = null;

    const updated = await admin.from('report_reviews').update(patch).eq('report_id', input.reportId).eq('organization_id', input.organizationId).eq('state', expected).select('id').maybeSingle();
    if (updated.error) return failure(updated.error, 'Could not save the review.');
    if (!updated.data) return { ok: false, status: 409, error: 'That review change is not allowed.' };

    if (input.plan.publishReport) {
        const published = await admin.from('reports').update({ status: 'published', updated_at: input.now }).eq('id', input.reportId).eq('organization_id', input.organizationId);
        if (published.error) return failure(published.error, 'Could not save the review.');
    }

    if (input.plan.updatePortal) {
        let portal: unknown = input.snapshot?.portal ?? null;
        if (!portal && versionId) {
            const row = await admin.from('report_versions').select('snapshot').eq('id', versionId).eq('report_id', input.reportId).eq('organization_id', input.organizationId).maybeSingle();
            if (row.error || !row.data) return failure(row.error, 'Could not load the frozen report.');
            portal = (row.data.snapshot as { portal?: unknown }).portal ?? null;
        }
        if (portal) {
            const share = await admin.from('client_portal_report_shares').update({ snapshot: portal }).eq('report_id', input.reportId).eq('organization_id', input.organizationId).eq('client_id', input.clientId).is('unshared_at', null);
            if (share.error) return failure(share.error, 'Could not save the review.');
        }
    }

    return { ok: true, versionId };
}

export async function readVersionSnapshot(reportId: string, organizationId: string, versionNo: number): Promise<ReportVersionSnapshot | null> {
    const { data, error } = await createAdminClient().from('report_versions')
        .select('snapshot')
        .eq('report_id', reportId)
        .eq('organization_id', organizationId)
        .eq('version_no', versionNo)
        .maybeSingle();
    if (error || !data?.snapshot || typeof data.snapshot !== 'object') return null;
    return data.snapshot as ReportVersionSnapshot;
}

export async function readApprovedPortalSnapshot(reportId: string, organizationId: string, clientId: string): Promise<PortalReportDetail | null> {
    const admin = createAdminClient();
    const review = await admin.from('report_reviews')
        .select('state, current_version_id')
        .eq('report_id', reportId)
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .maybeSingle();
    if (review.error) {
        if (review.error.code === '42P01') return null;
        throw new Error('Could not load the approved report');
    }
    const state = review.data?.state;
    const versionId = text(review.data?.current_version_id);
    if (!versionId || (state !== 'approved' && state !== 'scheduled' && state !== 'sent')) return null;
    const version = await admin.from('report_versions')
        .select('snapshot')
        .eq('id', versionId)
        .eq('report_id', reportId)
        .eq('organization_id', organizationId)
        .maybeSingle();
    if (version.error) throw new Error('Could not load the approved report');
    const portal = (version.data?.snapshot as { portal?: PortalReportDetail } | null)?.portal;
    return portal ?? null;
}

export async function reportHasFrozenVersion(reportId: string, organizationId: string): Promise<boolean> {
    const { data, error } = await createAdminClient().from('report_reviews')
        .select('state, current_version_id')
        .eq('report_id', reportId)
        .eq('organization_id', organizationId)
        .maybeSingle();
    if (error) return error.code !== '42P01';
    if (!text(data?.current_version_id)) return false;
    return data?.state === 'ready_for_review' || data?.state === 'approved' || data?.state === 'scheduled' || data?.state === 'sent';
}

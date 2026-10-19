/**
 * One aggregated read for the month-close board. Rows are paged so a 60-client
 * month is not cut at the API's default 1,000-row cap. There is no per-client
 * round trip.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { monthBounds } from '@/lib/sync/months';
import { instantAtPt } from './business-days';
import { buildCloseBoard, type CloseBoardView, type CloseRaw, type CloseRawDay, type CloseRawFact } from './close-board';

type DbError = { code?: string } | null;
type Page<T> = { data: T[] | null; error: DbError };

const PAGE = 1000;
const SOURCES = ['gsc', 'ga4', 'gbp', 'ahrefs'];

function unavailable(error: DbError): boolean {
    return error?.code === '42P01' || error?.code === '42703' || error?.code === '42883';
}

function failure(error: DbError): { ok: false; status: number; error: string } {
    if (unavailable(error)) return { ok: false, status: 503, error: 'The close board is not available yet.' };
    return { ok: false, status: 500, error: 'Could not load the close board.' };
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
    return null;
}

async function readAll<T>(query: (from: number, to: number) => PromiseLike<Page<T>>): Promise<{ rows: T[]; error: DbError }> {
    const rows: T[] = [];
    for (let from = 0; from < 20000; from += PAGE) {
        const page = await query(from, from + PAGE - 1);
        if (page.error) return { rows: [], error: page.error };
        const data = page.data ?? [];
        rows.push(...data);
        if (data.length < PAGE) return { rows, error: null };
    }
    return { rows: [], error: { code: 'limit' } };
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

export async function loadCloseBoard(
    organizationId: string,
    month: string,
    role: CloseRaw['role'],
    now: Date,
): Promise<{ ok: true; board: CloseBoardView } | { ok: false; status: number; error: string }> {
    const admin = createAdminClient();
    const bounds = monthBounds(month);
    const taskStart = instantAtPt(bounds.start, 0, 0).toISOString();
    const taskEnd = instantAtPt(nextDate(bounds.end), 0, 0).toISOString();

    const clients = await readAll<Record<string, unknown>>(range => admin
        .from('clients')
        .select('id, name, domain, account_manager_id, account_manager_name, seo_hours')
        .eq('organization_id', organizationId)
        // Monthly drafts run for status=active only. The sidebar Active tab also
        // includes Onboarding, so this count is the monthly-report population.
        .eq('status', 'active')
        .order('id')
        .range(range, range + PAGE - 1));
    if (clients.error) return failure(clients.error);

    const clientIds = new Set(clients.rows.map(row => String(row.id)));
    const [reports, reviews, integrations, contacts, timeLogs, tasks, deliverables, metrics, days] = await Promise.all([
        readAll<Record<string, unknown>>(range => admin.from('reports').select('id, client_id, kind, title, status, executive_summary, recommendations, sections, updated_at').eq('organization_id', organizationId).eq('report_month', month).order('id').range(range, range + PAGE - 1)),
        readAll<Record<string, unknown>>(range => admin.from('report_reviews').select('report_id, state, requires_owner_approval, am_approved_by, owner_approved_by, current_version_id, am_note, scheduled_for, sent_at, client_id').eq('organization_id', organizationId).order('id').range(range, range + PAGE - 1)),
        readAll<Record<string, unknown>>(range => admin.from('client_integrations').select('id, client_id, service, sync_status, last_synced_at, site_url:credentials->>site_url').eq('organization_id', organizationId).in('service', SOURCES).order('id').range(range, range + PAGE - 1)),
        readAll<Record<string, unknown>>(range => admin.from('client_portal_contacts').select('id, client_id').eq('organization_id', organizationId).is('revoked_at', null).order('id').range(range, range + PAGE - 1)),
        readAll<Record<string, unknown>>(range => admin.from('time_logs').select('id, client_id, hours').eq('organization_id', organizationId).eq('status', 'logged').eq('import_status', 'mapped').is('voided_at', null).gte('date', bounds.start).lte('date', bounds.end).order('id').range(range, range + PAGE - 1)),
        readAll<Record<string, unknown>>(range => admin.from('tasks').select('id, client_id').eq('organization_id', organizationId).eq('status', 'done').gte('completed_at', taskStart).lt('completed_at', taskEnd).order('id').range(range, range + PAGE - 1)),
        readAll<Record<string, unknown>>(range => admin.from('deliverables').select('id, client_id, published_url, delivered_on').eq('organization_id', organizationId).eq('status', 'Published').order('id').range(range, range + PAGE - 1)),
        readAll<Record<string, unknown>>(range => admin.from('metrics').select('id, client_id, source, data').eq('organization_id', organizationId).eq('metric_month', month).order('id').range(range, range + PAGE - 1)),
        readAll<Record<string, unknown>>(range => admin.from('gsc_history_days').select('id, client_id, property, data_date, is_incomplete').eq('organization_id', organizationId).eq('search_type', 'web').gte('data_date', bounds.start).lte('data_date', bounds.end).order('id').range(range, range + PAGE - 1)),
    ]);

    for (const result of [reports, reviews, integrations, contacts, timeLogs, tasks, deliverables, metrics, days]) {
        if (result.error) return failure(result.error);
    }

    const dayRows = days.rows.filter(row => clientIds.has(String(row.client_id)));
    const dayIds = dayRows.map(row => String(row.id));
    const facts: CloseRawFact[] = [];
    for (let index = 0; index < dayIds.length; index += 200) {
        const chunk = dayIds.slice(index, index + 200);
        const page = await readAll<Record<string, unknown>>(range => admin
            .from('gsc_history_facts')
            .select('day_id, clicks, impressions')
            .in('day_id', chunk)
            .eq('grain', 'property')
            .order('day_id')
            .range(range, range + PAGE - 1));
        if (page.error) return failure(page.error);
        for (const row of page.rows) {
            const clicks = num(row.clicks);
            const impressions = num(row.impressions);
            if (clicks == null || impressions == null) continue;
            facts.push({ dayId: String(row.day_id), clicks, impressions });
        }
    }

    const gscDays: CloseRawDay[] = dayRows.map(row => ({
        id: String(row.id),
        clientId: String(row.client_id),
        property: String(row.property ?? ''),
        date: String(row.data_date),
        isIncomplete: row.is_incomplete === true,
    }));

    const raw: CloseRaw = {
        month,
        now,
        role,
        clients: clients.rows.map(row => ({
            id: String(row.id),
            name: text(row.name) ?? 'Client',
            domain: text(row.domain),
            accountManagerId: text(row.account_manager_id),
            accountManagerName: text(row.account_manager_name),
            seoHours: num(row.seo_hours),
        })),
        reports: reports.rows.flatMap(row => {
            const clientId = text(row.client_id);
            if (!clientId || !clientIds.has(clientId)) return [];
            const sections = row.sections;
            return [{
                id: String(row.id),
                clientId,
                kind: text(row.kind),
                title: text(row.title) ?? 'Report',
                status: row.status === 'published' ? 'published' as const : 'draft' as const,
                executiveSummary: text(row.executive_summary),
                recommendations: text(row.recommendations),
                sections: sections == null || typeof sections === 'object' ? sections as CloseRaw['reports'][number]['sections'] : null,
                updatedAt: text(row.updated_at) ?? '',
            }];
        }),
        reviews: reviews.rows.flatMap(row => {
            const clientId = text(row.client_id);
            if (!clientId || !clientIds.has(clientId)) return [];
            return [{
                reportId: String(row.report_id),
                state: text(row.state) ?? 'draft',
                requiresOwnerApproval: row.requires_owner_approval === true,
                amApprovedBy: text(row.am_approved_by),
                ownerApprovedBy: text(row.owner_approved_by),
                currentVersionId: text(row.current_version_id),
                amNote: text(row.am_note),
                scheduledFor: text(row.scheduled_for),
                sentAt: text(row.sent_at),
            }];
        }),
        integrations: integrations.rows.flatMap(row => {
            const clientId = text(row.client_id);
            if (!clientId || !clientIds.has(clientId)) return [];
            return [{
                clientId,
                service: text(row.service) ?? '',
                syncStatus: text(row.sync_status),
                lastSyncedAt: text(row.last_synced_at),
                siteUrl: text(row.site_url),
            }];
        }),
        hours: timeLogs.rows.flatMap(row => {
            const clientId = text(row.client_id);
            const hours = num(row.hours);
            if (!clientId || !clientIds.has(clientId) || hours == null) return [];
            return [{ clientId, hours }];
        }),
        completedTaskClientIds: tasks.rows.flatMap(row => {
            const clientId = text(row.client_id);
            return clientId && clientIds.has(clientId) ? [clientId] : [];
        }),
        deliverables: deliverables.rows.flatMap(row => {
            const clientId = text(row.client_id);
            if (!clientId || !clientIds.has(clientId)) return [];
            return [{ clientId, publishedUrl: text(row.published_url), deliveredOn: text(row.delivered_on) }];
        }),
        metrics: metrics.rows.flatMap(row => {
            const clientId = text(row.client_id);
            if (!clientId || !clientIds.has(clientId)) return [];
            const data = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data as Record<string, unknown> : null;
            return [{ clientId, source: text(row.source) ?? '', data }];
        }),
        gscDays,
        gscFacts: facts,
        recipientClientIds: [...new Set(contacts.rows.flatMap(row => {
            const clientId = text(row.client_id);
            return clientId && clientIds.has(clientId) ? [clientId] : [];
        }))],
    };

    return { ok: true, board: buildCloseBoard(raw) };
}

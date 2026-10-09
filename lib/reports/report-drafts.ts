/**
 * Business day 3 in Pacific time: draft the prior month for active clients
 * whose Search Console month is final. A second run inserts nothing.
 * Nothing here sends email.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { blocksFromLegacy } from './blocks';
import { businessDayNumber } from './business-days';
import { reportAutodraftEnabled } from './autodraft-flag';
import { closeMonthName } from './close-view';
import { gscMonthReadout, type GscDayInput } from './versions';
import { monthBounds, previousMonth, ptMonth, ptToday } from '@/lib/sync/months';

export interface DraftCandidate {
    organizationId: string;
    clientId: string;
    clientName: string;
    gscConnected: boolean;
    gscFinal: boolean;
    monthlyReportId: string | null;
    hasReview: boolean;
}

export interface DraftCreate {
    organizationId: string;
    clientId: string;
    clientName: string;
    reportMonth: string;
    title: string;
}

export interface DraftReview {
    organizationId: string;
    clientId: string;
    reportId: string;
}

export interface DraftPlan {
    reportMonth: string;
    create: DraftCreate[];
    ensureReview: DraftReview[];
    skippedExisting: number;
    skippedNotFinal: number;
    skippedNoGsc: number;
}

export function planReportDrafts(input: {
    now: Date;
    candidates: DraftCandidate[];
    extraHolidays?: readonly string[];
}): { due: false; businessDay: number | null; reportMonth: string } | { due: true; plan: DraftPlan } {
    const today = ptToday(input.now);
    const businessDay = businessDayNumber(today, input.extraHolidays);
    const reportMonth = previousMonth(ptMonth(input.now));
    if (businessDay !== 3) return { due: false, businessDay, reportMonth };

    const plan: DraftPlan = {
        reportMonth,
        create: [],
        ensureReview: [],
        skippedExisting: 0,
        skippedNotFinal: 0,
        skippedNoGsc: 0,
    };
    const year = reportMonth.slice(0, 4);
    for (const candidate of input.candidates) {
        if (candidate.monthlyReportId) {
            plan.skippedExisting += 1;
            if (!candidate.hasReview) {
                plan.ensureReview.push({
                    organizationId: candidate.organizationId,
                    clientId: candidate.clientId,
                    reportId: candidate.monthlyReportId,
                });
            }
            continue;
        }
        if (!candidate.gscConnected) {
            plan.skippedNoGsc += 1;
            continue;
        }
        if (!candidate.gscFinal) {
            plan.skippedNotFinal += 1;
            continue;
        }
        plan.create.push({
            organizationId: candidate.organizationId,
            clientId: candidate.clientId,
            clientName: candidate.clientName,
            reportMonth,
            title: `${candidate.clientName} — ${closeMonthName(reportMonth)} ${year} SEO Report`,
        });
    }
    return { due: true, plan };
}

export interface DraftApplyResult {
    created: number;
    reviews: number;
    conflicts: number;
    errors: number;
    unavailable: boolean;
}

export interface DraftStore {
    insertReport: (row: DraftCreate) => Promise<{ ok: true; id: string } | { ok: false; conflict: boolean; unavailable: boolean }>;
    insertReview: (row: DraftReview) => Promise<{ ok: true } | { ok: false; conflict: boolean; unavailable: boolean }>;
    deleteReport: (id: string) => Promise<void>;
}

export async function applyReportDrafts(store: DraftStore, plan: DraftPlan): Promise<DraftApplyResult> {
    const result: DraftApplyResult = { created: 0, reviews: 0, conflicts: 0, errors: 0, unavailable: false };
    for (const row of plan.create) {
        const inserted = await store.insertReport(row);
        if (!inserted.ok) {
            if (inserted.unavailable) {
                result.unavailable = true;
                return result;
            }
            if (inserted.conflict) result.conflicts += 1;
            else result.errors += 1;
            continue;
        }
        const review = await store.insertReview({
            organizationId: row.organizationId,
            clientId: row.clientId,
            reportId: inserted.id,
        });
        if (!review.ok) {
            if (!review.conflict) await store.deleteReport(inserted.id);
            if (review.unavailable) {
                result.unavailable = true;
                return result;
            }
            if (review.conflict) result.reviews += 1;
            else result.errors += 1;
            continue;
        }
        result.created += 1;
        result.reviews += 1;
    }
    for (const row of plan.ensureReview) {
        const review = await store.insertReview(row);
        if (!review.ok) {
            if (review.unavailable) {
                result.unavailable = true;
                return result;
            }
            if (review.conflict) result.conflicts += 1;
            else result.errors += 1;
            continue;
        }
        result.reviews += 1;
    }
    return result;
}

type DbError = { code?: string } | null;

function classified(error: DbError): { ok: false; conflict: boolean; unavailable: boolean } {
    return {
        ok: false,
        conflict: error?.code === '23505',
        unavailable: error?.code === '42P01' || error?.code === '42703' || error?.code === '42883',
    };
}

function sections() {
    return { version: 2 as const, blocks: blocksFromLegacy(null) };
}

export function supabaseDraftStore(): DraftStore {
    const admin = createAdminClient();
    return {
        async insertReport(row) {
            const inserted = await admin.from('reports').insert({
                organization_id: row.organizationId,
                client_id: row.clientId,
                report_month: row.reportMonth,
                title: row.title,
                sections: sections(),
                status: 'draft',
                kind: 'monthly',
            }).select('id').single();
            if (inserted.error || !inserted.data) return classified(inserted.error);
            return { ok: true, id: String(inserted.data.id) };
        },
        async insertReview(row) {
            const inserted = await admin.from('report_reviews').insert({
                organization_id: row.organizationId,
                client_id: row.clientId,
                report_id: row.reportId,
                state: 'draft',
                requires_owner_approval: false,
            }).select('id').single();
            if (inserted.error || !inserted.data) return classified(inserted.error);
            return { ok: true };
        },
        async deleteReport(id) {
            await admin.from('reports').delete().eq('id', id);
        },
    };
}

interface LoadedDay {
    id: string;
    clientId: string;
    property: string;
    date: string;
    isIncomplete: boolean;
}

async function pageRows<T>(load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string } | null }>): Promise<{ rows: T[]; error: { code?: string } | null }> {
    const rows: T[] = [];
    for (let from = 0; from < 20000; from += 1000) {
        const page = await load(from, from + 999);
        if (page.error) return { rows: [], error: page.error };
        const data = page.data ?? [];
        rows.push(...data);
        if (data.length < 1000) return { rows, error: null };
    }
    return { rows: [], error: { code: 'limit' } };
}

async function loadCandidates(reportMonth: string): Promise<{ ok: true; candidates: DraftCandidate[] } | { ok: false; unavailable: boolean }> {
    const admin = createAdminClient();
    const bounds = monthBounds(reportMonth);
    const clients = await pageRows<Record<string, unknown>>(range => admin.from('clients').select('id, organization_id, name').eq('status', 'active').order('id').range(range, range + 999));
    if (clients.error) return { ok: false, unavailable: clients.error.code === '42P01' };
    const active = clients.rows;
    if (active.length === 0) return { ok: true, candidates: [] };

    const [reports, integrations, days] = await Promise.all([
        pageRows<Record<string, unknown>>(range => admin.from('reports').select('id, client_id, kind').eq('report_month', reportMonth).eq('kind', 'monthly').order('id').range(range, range + 999)),
        pageRows<Record<string, unknown>>(range => admin.from('client_integrations').select('id, client_id, sync_status, site_url:credentials->>site_url').eq('service', 'gsc').order('id').range(range, range + 999)),
        pageRows<Record<string, unknown>>(range => admin.from('gsc_history_days').select('id, client_id, property, data_date, is_incomplete').eq('search_type', 'web').gte('data_date', bounds.start).lte('data_date', bounds.end).order('id').range(range, range + 999)),
    ]);
    for (const result of [reports, integrations, days]) {
        if (result.error) return { ok: false, unavailable: result.error.code === '42P01' || result.error.code === '42703' };
    }

    const reportIds = reports.rows.map(row => String(row.id));
    const reviewed = new Set<string>();
    for (let index = 0; index < reportIds.length; index += 200) {
        const chunk = reportIds.slice(index, index + 200);
        const page = await admin.from('report_reviews').select('report_id').in('report_id', chunk);
        if (page.error) return { ok: false, unavailable: page.error.code === '42P01' || page.error.code === '42703' };
        for (const row of page.data ?? []) reviewed.add(String(row.report_id));
    }

    const dayRows: LoadedDay[] = days.rows.map(row => ({
        id: String(row.id),
        clientId: String(row.client_id),
        property: String(row.property ?? ''),
        date: String(row.data_date).slice(0, 10),
        isIncomplete: row.is_incomplete === true,
    }));
    const facts = new Map<string, { clicks: number; impressions: number }>();
    const dayIds = dayRows.map(day => day.id);
    for (let index = 0; index < dayIds.length; index += 200) {
        const chunk = dayIds.slice(index, index + 200);
        const page = await admin.from('gsc_history_facts').select('day_id, clicks, impressions').in('day_id', chunk).eq('grain', 'property');
        if (page.error) return { ok: false, unavailable: page.error.code === '42P01' };
        for (const row of page.data ?? []) {
            const clicks = typeof row.clicks === 'number' ? row.clicks : Number(row.clicks);
            const impressions = typeof row.impressions === 'number' ? row.impressions : Number(row.impressions);
            if (!Number.isFinite(clicks) || !Number.isFinite(impressions)) continue;
            if (!facts.has(String(row.day_id))) facts.set(String(row.day_id), { clicks, impressions });
        }
    }

    const monthlyByClient = new Map<string, string>();
    for (const row of reports.rows) {
        if (row.kind !== 'monthly' || !row.client_id) continue;
        if (!monthlyByClient.has(String(row.client_id))) monthlyByClient.set(String(row.client_id), String(row.id));
    }
    const gscByClient = new Map<string, { status: string | null; siteUrl: string | null }>();
    for (const row of integrations.rows) {
        const clientId = String(row.client_id);
        if (!gscByClient.has(clientId)) {
            gscByClient.set(clientId, { status: typeof row.sync_status === 'string' ? row.sync_status : null, siteUrl: typeof row.site_url === 'string' ? row.site_url : null });
        }
    }

    const candidates: DraftCandidate[] = active.map(row => {
        const clientId = String(row.id);
        const gsc = gscByClient.get(clientId);
        const connected = gsc?.status === 'active' || gsc?.status === 'error';
        let final = false;
        if (connected && gsc?.siteUrl) {
            const gscDays: GscDayInput[] = dayRows
                .filter(day => day.clientId === clientId && day.property === gsc.siteUrl)
                .map(day => ({
                    date: day.date,
                    isIncomplete: day.isIncomplete || !facts.has(day.id),
                    property: facts.get(day.id) ?? null,
                }));
            final = gscMonthReadout(reportMonth, gscDays).final;
        }
        const monthlyReportId = monthlyByClient.get(clientId) ?? null;
        return {
            organizationId: String(row.organization_id),
            clientId,
            clientName: typeof row.name === 'string' && row.name.trim() ? row.name : 'Client',
            gscConnected: connected,
            gscFinal: final,
            monthlyReportId,
            hasReview: monthlyReportId ? reviewed.has(monthlyReportId) : false,
        };
    });
    return { ok: true, candidates };
}

export interface DraftHandlerDeps {
    authorize: (request: Request) => boolean;
    enabled: () => boolean;
    now: () => Date;
    run: (now: Date) => Promise<
        | { ok: true; skipped: true; reason: 'not_business_day_3'; reportMonth: string }
        | { ok: true; skipped: false; reportMonth: string; created: number; reviews: number; conflicts: number; errors: number; skippedExisting: number; skippedNotFinal: number; skippedNoGsc: number }
        | { ok: false; status: number; error: string }
    >;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

export function createReportDraftHandler(deps: DraftHandlerDeps) {
    return async function handle(request: Request) {
        if (!deps.authorize(request)) return json({ error: 'Unauthorized' }, 401);
        if (!deps.enabled()) return json({ skipped: true, reason: 'disabled' });
        const result = await deps.run(deps.now());
        if (!result.ok) {
            const error = result.status === 503
                ? 'Report drafts are not available yet.'
                : 'Report drafts will retry on the next run.';
            return json({ error }, result.status);
        }
        if (result.skipped) return json({ skipped: true, reason: result.reason, reportMonth: result.reportMonth });
        return json({
            ok: true,
            reportMonth: result.reportMonth,
            created: result.created,
            reviews: result.reviews,
            conflicts: result.conflicts,
            errors: result.errors,
            skippedExisting: result.skippedExisting,
            skippedNotFinal: result.skippedNotFinal,
            skippedNoGsc: result.skippedNoGsc,
        });
    };
}

export async function runReportDrafts(now: Date): Promise<
    | { ok: true; skipped: true; reason: 'not_business_day_3'; reportMonth: string }
    | { ok: true; skipped: false; reportMonth: string; created: number; reviews: number; conflicts: number; errors: number; skippedExisting: number; skippedNotFinal: number; skippedNoGsc: number }
    | { ok: false; status: number; error: string }
> {
    const today = ptToday(now);
    const businessDay = businessDayNumber(today);
    const reportMonth = previousMonth(ptMonth(now));
    if (businessDay !== 3) return { ok: true, skipped: true, reason: 'not_business_day_3', reportMonth };

    const loaded = await loadCandidates(reportMonth);
    if (!loaded.ok) {
        return loaded.unavailable
            ? { ok: false, status: 503, error: 'Report drafts are not available yet.' }
            : { ok: false, status: 500, error: 'Report drafts will retry on the next run.' };
    }
    const planned = planReportDrafts({ now, candidates: loaded.candidates });
    if (!planned.due) return { ok: true, skipped: true, reason: 'not_business_day_3', reportMonth };
    try {
        const applied = await applyReportDrafts(supabaseDraftStore(), planned.plan);
        if (applied.unavailable) return { ok: false, status: 503, error: 'Report drafts are not available yet.' };
        if (applied.errors > 0) return { ok: false, status: 500, error: 'Report drafts will retry on the next run.' };
        return {
            ok: true,
            skipped: false,
            reportMonth,
            created: applied.created,
            reviews: applied.reviews,
            conflicts: applied.conflicts,
            errors: applied.errors,
            skippedExisting: planned.plan.skippedExisting,
            skippedNotFinal: planned.plan.skippedNotFinal,
            skippedNoGsc: planned.plan.skippedNoGsc,
        };
    } catch {
        return { ok: false, status: 500, error: 'Report drafts will retry on the next run.' };
    }
}

export function reportDraftHandler() {
    return createReportDraftHandler({
        authorize(request) {
            const secret = process.env.CRON_SECRET;
            return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
        },
        enabled: reportAutodraftEnabled,
        now: () => new Date(),
        run: runReportDrafts,
    });
}

export const REPORT_DRAFT_CRON_HOUR_UTC = 15;

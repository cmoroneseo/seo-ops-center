/**
 * Month-close board. One pass over already-loaded rows.
 * Column placement is closeCard(). Checks are evaluatePresendChecks().
 */

import { copySourcesForMetrics } from './copy-rules';
import { evaluatePresendChecks, type SourceHealth } from './presend-checks';
import { copyTextForSnapshot, gscMonthReadout, type GscDayInput } from './versions';
import { closeCard, emptyReview, ownerApprovalPending, type ReviewState } from './workflow';
import { isMissingProof, normalizeShipDate } from '@/lib/search-reporting/proof';
import { ptMonth } from '@/lib/sync/months';
import type { ReportSectionsField } from './blocks';
import {
    CLOSE_COLUMNS,
    closeMeta,
    closeMonthName,
    closeTitle,
    shiftMonth,
    type CloseBoardView,
    type CloseCardView,
    type CloseColumn,
    type CloseTrackerView,
    type CloseWaitingView,
} from './close-view';

export {
    CLOSE_COLUMNS,
    closeMeta,
    closeMonthName,
    closeTitle,
    filterCloseBoard,
    moveSelection,
    shiftMonth,
} from './close-view';
export type {
    CloseBoardView,
    CloseCardRef,
    CloseCardView,
    CloseColumn,
    CloseFilter,
    CloseStatusFilter,
    CloseTrackerView,
    CloseWaitingView,
} from './close-view';

const NO_RECIPIENT = 'No client has a portal contact on file. You can approve; scheduling waits for a recipient.';

export function clientInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

export function formatHours(value: number): string {
    if (!Number.isFinite(value)) return '0';
    const rounded = Math.round(value * 100) / 100;
    return String(rounded);
}

export function hoursLabel(logged: number, budget: number | null): string {
    const shown = formatHours(logged);
    if (budget == null) return `${shown}h logged`;
    return `${shown}/${formatHours(budget)}h`;
}

export interface CloseRawClient {
    id: string;
    name: string;
    domain: string | null;
    accountManagerId: string | null;
    accountManagerName: string | null;
    seoHours: number | null;
}

export interface CloseRawReport {
    id: string;
    clientId: string;
    kind: string | null;
    title: string;
    status: 'draft' | 'published';
    executiveSummary: string | null;
    recommendations: string | null;
    sections: ReportSectionsField;
    updatedAt: string;
}

export interface CloseRawReview {
    reportId: string;
    state: string;
    requiresOwnerApproval: boolean;
    amApprovedBy: string | null;
    ownerApprovedBy: string | null;
    currentVersionId: string | null;
    amNote: string | null;
    scheduledFor: string | null;
    sentAt: string | null;
}

export interface CloseRawIntegration {
    clientId: string;
    service: string;
    syncStatus: string | null;
    lastSyncedAt: string | null;
    siteUrl: string | null;
}

export interface CloseRawDay {
    id: string;
    clientId: string;
    property: string;
    date: string;
    isIncomplete: boolean;
}

export interface CloseRawFact {
    dayId: string;
    clicks: number;
    impressions: number;
}

export interface CloseRawDeliverable {
    clientId: string;
    publishedUrl: string | null;
    deliveredOn: string | null;
}

export interface CloseRawMetric {
    clientId: string;
    source: string;
    data: Record<string, unknown> | null;
}

export interface CloseRaw {
    month: string;
    now: Date;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    clients: CloseRawClient[];
    reports: CloseRawReport[];
    reviews: CloseRawReview[];
    integrations: CloseRawIntegration[];
    hours: { clientId: string; hours: number }[];
    completedTaskClientIds: string[];
    deliverables: CloseRawDeliverable[];
    metrics: CloseRawMetric[];
    gscDays: CloseRawDay[];
    gscFacts: CloseRawFact[];
    recipientClientIds: string[];
}

interface WorkedClient {
    client: CloseRawClient;
    managerId: string;
    managerName: string;
    searchText: string;
    loggedHours: number;
    tasksCompleted: number;
    gscConnected: boolean;
    gscFinal: boolean;
    gscClicks: number | null;
    gscImpressions: number | null;
    gscLastSyncedAt: string | null;
    gscErrored: boolean;
    sources: SourceHealth[];
    ga4Connected: boolean;
    gbpConnected: boolean;
    ahrefsErrored: boolean;
    hasRecipient: boolean;
    shipped: number;
    missingProofCount: number;
    report: CloseRawReport | null;
    review: CloseRawReview | null;
    metrics: CloseRawMetric[];
}

function managerIdFor(client: CloseRawClient): string {
    if (client.accountManagerId) return client.accountManagerId;
    const name = client.accountManagerName?.trim();
    return name ? `name:${name.toLowerCase()}` : 'unassigned';
}

function managerNameFor(client: CloseRawClient): string {
    return client.accountManagerName?.trim() || 'Unassigned';
}

function finiteHours(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function pickReport(reports: CloseRawReport[]): CloseRawReport | null {
    if (reports.length === 0) return null;
    const monthly = reports.filter(report => report.kind === 'monthly');
    const pool = monthly.length > 0 ? monthly : reports;
    return [...pool].sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : left.updatedAt > right.updatedAt ? -1 : left.id < right.id ? -1 : 1))[0];
}

function reviewState(value: string | undefined): ReviewState {
    if (value === 'ready_for_review' || value === 'approved' || value === 'scheduled' || value === 'sent') return value;
    return 'draft';
}

function sourceHealth(rows: CloseRawIntegration[], service: SourceHealth['source']): SourceHealth {
    const row = rows.find(item => item.service === service);
    const status = row?.syncStatus ?? null;
    return {
        source: service,
        connected: status === 'active' || status === 'error',
        errored: status === 'error',
        lastSyncedAt: row?.lastSyncedAt ?? null,
    };
}

function readoutFor(month: string, clientId: string, property: string | null, days: CloseRawDay[], facts: Map<string, CloseRawFact>): {
    final: boolean;
    clicks: number | null;
    impressions: number | null;
} {
    if (!property) return { final: false, clicks: null, impressions: null };
    const gscDays: GscDayInput[] = [];
    for (const day of days) {
        if (day.clientId !== clientId || day.property !== property) continue;
        const fact = facts.get(day.id);
        gscDays.push({
            date: day.date.slice(0, 10),
            isIncomplete: day.isIncomplete || !fact,
            property: fact ? { clicks: fact.clicks, impressions: fact.impressions } : null,
        });
    }
    const readout = gscMonthReadout(month, gscDays);
    return {
        final: readout.final,
        clicks: readout.clicks,
        impressions: readout.impressions,
    };
}

function tasksLabel(count: number): string {
    return `${count} ${count === 1 ? 'task' : 'tasks'}`;
}

function byName<T extends { clientName: string }>(rows: T[]): T[] {
    return [...rows].sort((left, right) => left.clientName.localeCompare(right.clientName));
}

function recipientMessage(clients: { hasRecipient: boolean }[]): string | null {
    if (clients.length === 0) return null;
    const missing = clients.filter(client => !client.hasRecipient).length;
    if (missing === 0) return null;
    if (missing === clients.length) return NO_RECIPIENT;
    if (missing === 1) return '1 client has no portal contact on file. You can approve; scheduling waits for a recipient.';
    return `${missing} clients have no portal contact on file. You can approve; scheduling waits for a recipient.`;
}

export function buildCloseBoard(raw: CloseRaw): CloseBoardView {
    const facts = new Map<string, CloseRawFact>();
    for (const fact of raw.gscFacts) {
        if (!Number.isFinite(fact.clicks) || !Number.isFinite(fact.impressions) || fact.clicks < 0 || fact.impressions < 0) continue;
        if (!facts.has(fact.dayId)) facts.set(fact.dayId, fact);
    }
    const hoursByClient = new Map<string, number>();
    for (const row of raw.hours) {
        hoursByClient.set(row.clientId, (hoursByClient.get(row.clientId) ?? 0) + finiteHours(row.hours));
    }
    const tasksByClient = new Map<string, number>();
    for (const clientId of raw.completedTaskClientIds) {
        tasksByClient.set(clientId, (tasksByClient.get(clientId) ?? 0) + 1);
    }
    const reportsByClient = new Map<string, CloseRawReport[]>();
    for (const report of raw.reports) {
        const list = reportsByClient.get(report.clientId) ?? [];
        list.push(report);
        reportsByClient.set(report.clientId, list);
    }
    const reviewsByReport = new Map<string, CloseRawReview>();
    for (const review of raw.reviews) reviewsByReport.set(review.reportId, review);
    const integrationsByClient = new Map<string, CloseRawIntegration[]>();
    for (const row of raw.integrations) {
        const list = integrationsByClient.get(row.clientId) ?? [];
        list.push(row);
        integrationsByClient.set(row.clientId, list);
    }
    const metricsByClient = new Map<string, CloseRawMetric[]>();
    for (const row of raw.metrics) {
        const list = metricsByClient.get(row.clientId) ?? [];
        list.push(row);
        metricsByClient.set(row.clientId, list);
    }
    const proofByClient = new Map<string, { shipped: number; missing: number }>();
    for (const row of raw.deliverables) {
        const current = proofByClient.get(row.clientId) ?? { shipped: 0, missing: 0 };
        if (isMissingProof({ status: 'Published', publishedUrl: row.publishedUrl, deliveredOn: row.deliveredOn })) {
            current.missing += 1;
        } else {
            const shippedOn = normalizeShipDate(row.deliveredOn);
            if (shippedOn?.slice(0, 7) === raw.month) current.shipped += 1;
        }
        proofByClient.set(row.clientId, current);
    }
    const recipients = new Set(raw.recipientClientIds);

    const worked: WorkedClient[] = raw.clients.map(client => {
        const integrations = integrationsByClient.get(client.id) ?? [];
        const sources: SourceHealth[] = ['gsc', 'ga4', 'gbp', 'ahrefs'].map(service => sourceHealth(integrations, service as SourceHealth['source']));
        const gsc = sources[0];
        const property = integrations.find(row => row.service === 'gsc')?.siteUrl ?? null;
        const readout = gsc.connected ? readoutFor(raw.month, client.id, property, raw.gscDays, facts) : { final: false, clicks: null, impressions: null };
        const proof = proofByClient.get(client.id) ?? { shipped: 0, missing: 0 };
        const report = pickReport(reportsByClient.get(client.id) ?? []);
        return {
            client,
            managerId: managerIdFor(client),
            managerName: managerNameFor(client),
            searchText: `${client.name} ${client.domain ?? ''}`.trim(),
            loggedHours: hoursByClient.get(client.id) ?? 0,
            tasksCompleted: tasksByClient.get(client.id) ?? 0,
            gscConnected: gsc.connected,
            gscFinal: Boolean(gsc.connected) && readout.final,
            gscClicks: gsc.connected ? readout.clicks : null,
            gscImpressions: gsc.connected ? readout.impressions : null,
            gscLastSyncedAt: gsc.lastSyncedAt,
            gscErrored: gsc.errored,
            sources,
            ga4Connected: sources[1].connected,
            gbpConnected: sources[2].connected,
            ahrefsErrored: sources[3].errored,
            hasRecipient: recipients.has(client.id),
            shipped: proof.shipped,
            missingProofCount: proof.missing,
            report,
            review: report ? reviewsByReport.get(report.id) ?? null : null,
            metrics: metricsByClient.get(client.id) ?? [],
        };
    });

    const columns: Record<CloseColumn, CloseCardView[]> = { blocked: [], ready: [], approved: [], sent: [] };
    const noSearchConsole: CloseWaitingView[] = [];
    const pendingDrafts: CloseWaitingView[] = [];
    const trackerErrors: CloseTrackerView[] = [];

    for (const row of worked) {
        const waitingBase = {
            clientId: row.client.id,
            clientName: row.client.name,
            managerId: row.managerId,
            searchText: row.searchText,
            hoursLabel: hoursLabel(row.loggedHours, row.client.seoHours),
            loggedHours: row.loggedHours,
            connectHref: `/workspace/${row.client.id}?tab=integrations`,
        };
        if (!row.report) {
            if (!row.gscConnected) noSearchConsole.push(waitingBase);
            else pendingDrafts.push(waitingBase);
            continue;
        }

        const review = row.review;
        const state = reviewState(review?.state);
        const record = review
            ? {
                ...emptyReview(),
                exists: true,
                state,
                requiresOwnerApproval: review.requiresOwnerApproval,
                amApprovedBy: review.amApprovedBy,
                ownerApprovedBy: review.ownerApprovedBy,
                currentVersionId: review.currentVersionId,
            }
            : emptyReview();
        const pending = ownerApprovalPending(record);
        const note = review?.amNote ?? null;
        const current = Object.fromEntries(row.metrics.map(metric => [metric.source, metric.data ?? {}]));
        const copy = copyTextForSnapshot({
            executiveSummary: row.report.executiveSummary ?? '',
            recommendations: row.report.recommendations ?? '',
            amNote: note,
            sections: row.report.sections,
        });
        const checks = evaluatePresendChecks({
            reportMonth: raw.month,
            now: raw.now,
            gsc: {
                connected: row.gscConnected,
                final: row.gscFinal,
                clicks: row.gscClicks,
                impressions: row.gscImpressions,
                lastSyncedAt: row.gscLastSyncedAt,
                errored: row.gscErrored,
            },
            sources: row.sources,
            rankChecks: [],
            hours: row.loggedHours,
            tasksCompleted: row.tasksCompleted,
            shipped: row.shipped,
            missingProofCount: row.missingProofCount,
            copyText: copy.text,
            copySources: copySourcesForMetrics(current),
            amNote: note,
            hasRecipient: row.hasRecipient,
        });
        const card = closeCard({
            reportId: row.report.id,
            clientId: row.client.id,
            reportMonth: raw.month,
            state,
            gscConnected: row.gscConnected,
            hasRecipient: row.hasRecipient,
            requiresOwnerApproval: record.requiresOwnerApproval,
            ownerApprovalPending: pending,
            checks: checks.checks,
        });
        if (row.ahrefsErrored && row.gscConnected) {
            trackerErrors.push({
                clientId: row.client.id,
                clientName: row.client.name,
                managerId: row.managerId,
                searchText: row.searchText,
                reportId: row.report.id,
            });
        }
        if (card.lane === 'waiting_on_data' || !card.column) {
            noSearchConsole.push(waitingBase);
            continue;
        }
        const open = state === 'draft' || (state === 'ready_for_review' && !pending);
        const budget = row.client.seoHours;
        columns[card.column].push({
            reportId: row.report.id,
            clientId: row.client.id,
            clientName: row.client.name,
            initials: clientInitials(row.client.name),
            managerId: row.managerId,
            managerName: row.managerName,
            searchText: row.searchText,
            hoursLabel: hoursLabel(row.loggedHours, budget),
            hoursRatio: budget && budget > 0 ? Math.min(1, row.loggedHours / budget) : null,
            tasksLabel: tasksLabel(row.tasksCompleted),
            state,
            column: card.column,
            blockingCount: card.blockingCount,
            warnCount: card.warnCount,
            trackerWarning: card.trackerWarning,
            schedulingWaitsForRecipient: card.schedulingWaitsForRecipient,
            ownerApprovalPending: pending,
            gscFinal: row.gscFinal,
            ga4Connected: row.ga4Connected,
            gbpConnected: row.gbpConnected,
            checks: checks.checks,
            canApprove: raw.role === 'viewer' ? false : pending ? raw.role === 'owner' : open && checks.canApprove,
            canSchedule: raw.role !== 'viewer' && state === 'approved' && checks.canSchedule,
            previewHref: `/reports/${row.report.id}?range=${raw.month}`,
            scheduledFor: review?.scheduledFor ?? null,
        });
    }

    for (const column of CLOSE_COLUMNS) {
        columns[column].sort((left, right) => {
            if (column === 'blocked' && left.blockingCount !== right.blockingCount) return right.blockingCount - left.blockingCount;
            return left.clientName.localeCompare(right.clientName);
        });
    }

    const managers = new Map<string, string>();
    for (const row of worked) managers.set(row.managerId, row.managerName);
    const missingContact = worked.find(row => !row.hasRecipient) ?? worked[0];
    const bannerMessage = recipientMessage(worked);
    const drafts = columns.blocked.length + columns.ready.length;
    const waitingOnData = noSearchConsole.length + pendingDrafts.length;
    const currentMonth = ptMonth(raw.now);

    return {
        month: raw.month,
        monthName: closeMonthName(raw.month),
        title: closeTitle(raw.month),
        meta: closeMeta(raw.clients.length, drafts, waitingOnData),
        actorRole: raw.role,
        activeClients: raw.clients.length,
        drafts,
        waitingOnData,
        monthHasDrafts: drafts > 0,
        banner: bannerMessage ? {
            message: bannerMessage,
            addContactsHref: missingContact ? `/workspace/${missingContact.client.id}?tab=portal` : '/workspace',
        } : null,
        noSearchConsole: byName(noSearchConsole),
        pendingDrafts: byName(pendingDrafts),
        trackerErrors: byName(trackerErrors),
        hoursLoggedWithoutConsole: noSearchConsole.filter(row => row.loggedHours > 0).length,
        columns,
        managers: [...managers.entries()]
            .map(([id, name]) => ({ id, name }))
            .sort((left, right) => left.name.localeCompare(right.name)),
        previousMonth: shiftMonth(raw.month, -1),
        nextMonth: shiftMonth(raw.month, 1),
        nextInProgress: (shiftMonth(raw.month, 1) ?? '') >= currentMonth,
        inProgress: raw.month >= currentMonth,
    };
}

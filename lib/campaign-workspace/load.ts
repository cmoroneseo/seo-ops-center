/**
 * Browser read for Campaign Overview and Results.
 *
 * Search Console uses the same history loader and paired window as the Search
 * dashboard. Business Profile reads monthly `metrics` rows through the user
 * client (org RLS). Content approvals reuse the existing batch/doc queries.
 * This module does not read or write the strategy-builder plan.
 */

import { loadHistory, type HistoryDay, type HistoryRow } from '@/lib/gsc/insights';
import { ptToday } from '@/lib/sync/months';
import { historyChunks, sourceConnections } from '@/lib/search-dashboard/model';
import { createClient } from '@/lib/supabase/client';
import { listBatchesForClient, listDocsForBatch } from '@/lib/supabase/content-approvals';
import {
    campaignLocalProfile,
    campaignSitewide,
    countAwaitingApproval,
    emptyLocalProfile,
    emptySitewide,
    type CampaignMeasurement,
    type GbpMetricRow,
} from './sources';

export interface CampaignLoadDeps {
    loadHistory: typeof loadHistory;
    fetchIntegrations: (organizationId: string, clientId: string, signal: AbortSignal) => Promise<{ gsc: boolean; failed: boolean }>;
    readGbp: (organizationId: string, clientId: string) => Promise<GbpMetricRow[]>;
    readApprovals: (clientId: string) => Promise<number | null>;
}

function disconnectedMessage(message: string): boolean {
    return /property first|select a gsc property/i.test(message);
}

function aborted(error: unknown, signal: AbortSignal): boolean {
    return signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
}

async function loadChunk(
    load: typeof loadHistory,
    clientId: string,
    span: { start: string; end: string },
    signal: AbortSignal,
): Promise<{ days: HistoryDay[]; rows: HistoryRow[]; error: string; truncated: boolean }> {
    try {
        const history = await load(clientId, span, 'property', signal);
        return { days: history.days, rows: history.rows, error: '', truncated: history.truncated };
    } catch (reason) {
        if (aborted(reason, signal)) throw reason;
        const message = reason instanceof Error ? reason.message : 'Unable to load Search Console.';
        return { days: [], rows: [], error: message, truncated: false };
    }
}

async function fetchIntegrations(organizationId: string, clientId: string, signal: AbortSignal): Promise<{ gsc: boolean; failed: boolean }> {
    const params = new URLSearchParams({ clientId, orgId: organizationId });
    const response = await fetch(`/api/integrations/status?${params}`, { signal, credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return { gsc: false, failed: true };
    const body = await response.json().catch(() => ({}));
    const rows = Array.isArray(body.integrations) ? body.integrations : [];
    return { gsc: sourceConnections(rows).gsc, failed: false };
}

async function readGbp(organizationId: string, clientId: string): Promise<GbpMetricRow[]> {
    const supabase = createClient();
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('metrics')
        .select('metric_month, data')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .eq('source', 'gbp');
    if (error) throw new Error('Business Profile metrics are not available.');
    const rows: GbpMetricRow[] = [];
    for (const row of data ?? []) {
        if (!row || typeof row !== 'object') continue;
        const record = row as { metric_month?: unknown; data?: unknown };
        if (typeof record.metric_month !== 'string') continue;
        const metricData = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {};
        rows.push({ metricMonth: record.metric_month, data: metricData });
    }
    return rows;
}

async function readApprovals(clientId: string): Promise<number | null> {
    const batches = await listBatchesForClient(clientId, { throwOnError: true });
    const groups = await Promise.all(batches.map(async batch => {
        const docs = await listDocsForBatch(batch.id, { throwOnError: true });
        return docs.map(doc => ({
            batchStatus: batch.status,
            sentAt: batch.sentAt ?? null,
            status: doc.status,
            archivedAt: doc.archivedAt ?? null,
        }));
    }));
    return countAwaitingApproval(groups.flat());
}

const defaultDeps: CampaignLoadDeps = {
    loadHistory,
    fetchIntegrations,
    readGbp,
    readApprovals,
};

export async function loadCampaignMeasurement(input: {
    organizationId: string;
    clientId: string;
    signal: AbortSignal;
    now?: Date;
}, deps: CampaignLoadDeps = defaultDeps): Promise<CampaignMeasurement> {
    const now = input.now ?? new Date();
    const today = ptToday(now);
    const chunks = historyChunks(today);
    const [recent, older, connections, gbpRows, awaitingApproval] = await Promise.all([
        loadChunk(deps.loadHistory, input.clientId, chunks[0], input.signal),
        loadChunk(deps.loadHistory, input.clientId, chunks[1], input.signal),
        deps.fetchIntegrations(input.organizationId, input.clientId, input.signal).catch(error => {
            if (aborted(error, input.signal)) throw error;
            return { gsc: false, failed: true };
        }),
        deps.readGbp(input.organizationId, input.clientId).catch(error => {
            if (aborted(error, input.signal)) throw error;
            return null;
        }),
        deps.readApprovals(input.clientId).catch(error => {
            if (aborted(error, input.signal)) throw error;
            return null;
        }),
    ]);

    const historyErrors = [recent.error, older.error].filter(Boolean);
    const disconnected = historyErrors.length > 0 && historyErrors.every(disconnectedMessage);
    const historyFailed = historyErrors.length === 2 && !disconnected;
    const truncated = recent.truncated || older.truncated;
    const days = [...older.days, ...recent.days];
    const rows = [...older.rows, ...recent.rows];
    const connected = !disconnected && (connections.gsc || days.length > 0) && !historyFailed;
    const gsc = truncated
        ? emptySitewide('incomplete')
        : historyFailed
            ? emptySitewide('unavailable')
            : campaignSitewide({ connected, days, rows, today });

    return {
        gsc,
        gbp: gbpRows == null ? emptyLocalProfile() : campaignLocalProfile(gbpRows, now),
        awaitingApproval,
    };
}

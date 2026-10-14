import type { SupabaseClient } from '@supabase/supabase-js';
import { bingWebmasterEnabled } from './flags';
import type { BingClientRow, BingIntegrationRow } from './match';
import { BING_PARK_SECONDS, BING_SYNC_FAILED_MESSAGE, BING_UNVERIFIED_MESSAGE } from './sync';
import type { BingJob, BingRelease, BingStore } from './run';

const PAGE = 1000;
const MAX_ROWS = 20000;
const STORAGE_ERROR = 'Bing sync storage failed';

type DbError = { code?: string; message?: string } | null;
type DbResult = { data: unknown; error: DbError };

function fail(): never {
    throw new Error(STORAGE_ERROR);
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

async function readPages(
    query: (from: number, to: number) => PromiseLike<DbResult>,
): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
        const page = await query(from, from + PAGE - 1);
        if (page.error) fail();
        const data = Array.isArray(page.data) ? page.data : [];
        for (const row of data) {
            if (row && typeof row === 'object') rows.push(row as Record<string, unknown>);
        }
        if (data.length < PAGE) return rows;
    }
    fail();
}

function requireOrg(organizationId: string, env: NodeJS.ProcessEnv): void {
    if (!bingWebmasterEnabled(env, organizationId)) fail();
}

export function createBingStore(admin: SupabaseClient, env: NodeJS.ProcessEnv = process.env, now: () => Date = () => new Date()): BingStore {
    return {
        async listClients(organizationId) {
            requireOrg(organizationId, env);
            const rows = await readPages((from, to) => admin
                .from('clients')
                .select('id, organization_id, domain, status')
                .eq('organization_id', organizationId)
                .order('id', { ascending: true })
                .range(from, to));
            return rows.map((row): BingClientRow => {
                if (row.organization_id !== organizationId) fail();
                const id = text(row.id);
                if (!id) fail();
                return {
                    id,
                    organizationId,
                    domain: typeof row.domain === 'string' ? row.domain : null,
                    status: typeof row.status === 'string' ? row.status : '',
                };
            });
        },
        async listIntegrations(organizationId) {
            requireOrg(organizationId, env);
            const rows = await readPages((from, to) => admin
                .from('client_integrations')
                .select('id, client_id, organization_id, sync_status, site_url:credentials->>site_url')
                .eq('organization_id', organizationId)
                .eq('service', 'bing')
                .order('id', { ascending: true })
                .range(from, to));
            return rows.map((row): BingIntegrationRow => {
                if (row.organization_id !== organizationId) fail();
                const clientId = text(row.client_id);
                if (!clientId) fail();
                return {
                    clientId,
                    organizationId,
                    syncStatus: typeof row.sync_status === 'string' ? row.sync_status : '',
                    siteUrl: typeof row.site_url === 'string' ? row.site_url : null,
                };
            });
        },
        async insertMapping(action) {
            requireOrg(action.organizationId, env);
            const { error } = await admin.from('client_integrations').insert({
                organization_id: action.organizationId,
                client_id: action.clientId,
                service: 'bing',
                credentials: { site_url: action.siteUrl },
                sync_status: 'active',
                error_message: null,
            });
            if (!error) return true;
            if (error.code === '23505') return false;
            fail();
        },
        async markUnverified(action) {
            requireOrg(action.organizationId, env);
            const availableAt = new Date(now().getTime() + BING_PARK_SECONDS * 1000).toISOString();
            const integration = await admin.from('client_integrations').update({
                sync_status: 'error',
                error_message: BING_UNVERIFIED_MESSAGE,
            }).eq('organization_id', action.organizationId)
                .eq('client_id', action.clientId)
                .eq('service', 'bing')
                .eq('credentials->>site_url', action.siteUrl)
                .in('sync_status', ['active', 'error', 'pending_setup']);
            if (integration.error) fail();
            const job = await admin.from('bing_sync_jobs').update({
                status: 'idle',
                available_at: availableAt,
                lease_token: null,
                lease_until: null,
                updated_at: now().toISOString(),
            }).eq('organization_id', action.organizationId)
                .eq('client_id', action.clientId)
                .eq('site_url', action.siteUrl);
            if (job.error) fail();
        },
        async enqueue(organizationId, clientId) {
            requireOrg(organizationId, env);
            const { data, error } = await admin.rpc('enqueue_bing_sync', {
                p_organization_id: organizationId,
                p_client_id: clientId,
            });
            if (error || typeof data !== 'boolean') fail();
            return data;
        },
        async claim(requestedClientId?: string | null) {
            const { data, error } = await admin.rpc('claim_bing_sync', { p_client_id: requestedClientId ?? null });
            if (error) fail();
            const row = Array.isArray(data) ? data[0] : null;
            if (!row || typeof row !== 'object') return null;
            const record = row as Record<string, unknown>;
            const id = text(record.id);
            const organizationId = text(record.organization_id);
            const clientId = text(record.client_id);
            const siteUrl = text(record.site_url);
            const leaseToken = text(record.lease_token);
            const attempts = record.attempts;
            if (!id || !organizationId || !clientId || !siteUrl || !leaseToken || typeof attempts !== 'number') fail();
            const job: BingJob = { id, organizationId, clientId, siteUrl, leaseToken, attempts };
            return job;
        },
        async release(input: BingRelease) {
            const patch: Record<string, unknown> = {
                status: input.status,
                available_at: input.availableAt,
                lease_token: null,
                lease_until: null,
                updated_at: now().toISOString(),
            };
            if (input.resetAttempts) patch.attempts = 0;
            const { data, error } = await admin.from('bing_sync_jobs').update(patch)
                .eq('id', input.id)
                .eq('lease_token', input.leaseToken)
                .select('id');
            if (error || !Array.isArray(data) || data.length !== 1) fail();
        },
        async replace(input) {
            requireOrg(input.organizationId, env);
            const { data, error } = await admin.rpc('replace_bing_snapshot', {
                p_organization_id: input.organizationId,
                p_client_id: input.clientId,
                p_site_url: input.siteUrl,
                p_fetched_at: input.fetchedAt,
                p_traffic: input.traffic,
                p_queries: input.queries,
                p_pages: input.pages,
            });
            if (error || typeof data !== 'boolean') fail();
            return data;
        },
        async markSynced(job) {
            requireOrg(job.organizationId, env);
            const { error } = await admin.from('client_integrations').update({
                sync_status: 'active',
                error_message: null,
                last_synced_at: now().toISOString(),
            }).eq('organization_id', job.organizationId)
                .eq('client_id', job.clientId)
                .eq('service', 'bing')
                .eq('credentials->>site_url', job.siteUrl)
                .in('sync_status', ['active', 'error']);
            if (error) fail();
        },
        async markFailed(job, message) {
            requireOrg(job.organizationId, env);
            if (message !== BING_SYNC_FAILED_MESSAGE) fail();
            const { error } = await admin.from('client_integrations').update({
                sync_status: 'error',
                error_message: message,
            }).eq('organization_id', job.organizationId)
                .eq('client_id', job.clientId)
                .eq('service', 'bing')
                .eq('credentials->>site_url', job.siteUrl)
                .in('sync_status', ['active', 'error']);
            if (error) fail();
        },
    };
}

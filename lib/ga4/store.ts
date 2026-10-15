import 'server-only';

import { GA4_REAUTH_ERROR } from './connection-health';
import type { Ga4ConnectedClient, Ga4Job, Ga4QueueKind, Ga4Release, Ga4Store } from './run';
import type { Ga4DayWrite } from './sync';

const PROPERTY = /^properties\/[0-9]+$/;
const GA4_SYNC_FAILED = 'GA4 sync failed';

type Admin = {
    from: (table: string) => Query;
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

interface Query {
    select: (columns: string, options?: { count?: 'exact'; head?: boolean }) => Query;
    eq: (column: string, value: unknown) => Query;
    in: (column: string, values: readonly string[]) => Query;
    update: (values: Record<string, unknown>) => Query;
    upsert: (values: Record<string, unknown>, options: { onConflict: string }) => Query;
    maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }>;
    then: PromiseLike<{ data: unknown; error: { message?: string } | null; count: number | null }>['then'];
}

function fail(message = 'GA4 sync will retry'): never {
    throw new Error(message);
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

export function createGa4Store(admin: Admin, now: () => Date = () => new Date()): Ga4Store {
    return {
        async listConnected(organizationId) {
            const { data, error } = await admin.from('client_integrations')
                .select('client_id, property_id:credentials->>property_id')
                .eq('organization_id', organizationId)
                .eq('service', 'ga4')
                .in('sync_status', ['active', 'error']);
            if (error) fail();
            const rows = Array.isArray(data) ? data : [];
            const clients: Ga4ConnectedClient[] = [];
            for (const row of rows) {
                if (!row || typeof row !== 'object') continue;
                const record = row as { client_id?: unknown; property_id?: unknown };
                const clientId = text(record.client_id);
                const propertyId = text(record.property_id);
                if (clientId && propertyId && PROPERTY.test(propertyId)) clients.push({ clientId, propertyId });
            }
            return clients;
        },
        async enqueueDaily(organizationId, clientId) {
            const { data, error } = await admin.rpc('enqueue_ga4_sync', {
                p_organization_id: organizationId,
                p_client_id: clientId,
            });
            if (error || typeof data !== 'boolean') fail();
            return data;
        },
        async enqueueBackfill(organizationId, clientId) {
            const { data, error } = await admin.rpc('enqueue_ga4_backfill', {
                p_organization_id: organizationId,
                p_client_id: clientId,
            });
            if (error || typeof data !== 'boolean') fail();
            return data;
        },
        async hasWork(kind) {
            const { count, error } = await admin.from('ga4_sync_jobs')
                .select('id', { count: 'exact', head: true })
                .eq('kind', kind)
                .in('status', ['pending', 'running']);
            if (error) fail();
            return (count ?? 0) > 0;
        },
        async claim(kind: Ga4QueueKind) {
            const { data, error } = await admin.rpc('claim_ga4_sync', { p_client_id: null, p_kind: kind });
            if (error) fail();
            const row = Array.isArray(data) ? data[0] : null;
            if (!row || typeof row !== 'object') return null;
            const record = row as Record<string, unknown>;
            const id = text(record.id);
            const organizationId = text(record.organization_id);
            const clientId = text(record.client_id);
            const property = text(record.property);
            const jobKind = record.kind === 'daily' || record.kind === 'backfill' ? record.kind : null;
            const leaseToken = text(record.lease_token);
            const attempts = record.attempts;
            if (!id || !organizationId || !clientId || !property || !jobKind || !leaseToken || typeof attempts !== 'number') fail();
            const job: Ga4Job = {
                id, organizationId, clientId, property, kind: jobKind, leaseToken, attempts,
                cursorDate: typeof record.cursor_date === 'string' ? record.cursor_date.slice(0, 10) : null,
            };
            return job;
        },
        async release(input: Ga4Release) {
            const patch: Record<string, unknown> = {
                status: input.status,
                available_at: input.availableAt,
                lease_token: null,
                lease_until: null,
                last_error: input.lastError,
                updated_at: now().toISOString(),
            };
            if (input.cursorDate !== undefined) patch.cursor_date = input.cursorDate;
            const { data, error } = await admin.from('ga4_sync_jobs').update(patch)
                .eq('id', input.id)
                .eq('lease_token', input.leaseToken)
                .select('id');
            if (error || !Array.isArray(data) || data.length !== 1) fail();
        },
        async replaceDay(job, fetchedAt, day: Ga4DayWrite) {
            const { data, error } = await admin.rpc('replace_ga4_day', {
                p_organization_id: job.organizationId,
                p_client_id: job.clientId,
                p_property: job.property,
                p_day: day.day,
                p_fetched_at: fetchedAt,
                p_is_final: day.isFinal,
                p_sampled: day.sampled,
                p_thresholded: day.thresholded,
                p_daily: day.daily,
                p_landing_pages: day.landingPages,
            });
            if (error || typeof data !== 'boolean') fail();
            return data;
        },
        async keyEventOverride(job) {
            const { data, error } = await admin.from('client_ga4_settings')
                .select('ga4_key_events')
                .eq('organization_id', job.organizationId)
                .eq('client_id', job.clientId)
                .maybeSingle();
            if (error) fail();
            if (!data || typeof data !== 'object') return null;
            const events = (data as { ga4_key_events?: unknown }).ga4_key_events;
            if (events == null) return null;
            if (!Array.isArray(events) || events.some(event => typeof event !== 'string')) fail();
            return events as string[];
        },
        async markSynced(job) {
            const { error } = await admin.from('client_integrations').update({
                sync_status: 'active',
                error_message: null,
                last_synced_at: now().toISOString(),
            }).eq('organization_id', job.organizationId)
                .eq('client_id', job.clientId)
                .eq('service', 'ga4')
                .eq('credentials->>property_id', job.property)
                .in('sync_status', ['active', 'error']);
            if (error) fail();
        },
        async markReauth(job) {
            const { error } = await admin.from('client_integrations').update({
                sync_status: 'error',
                error_message: GA4_REAUTH_ERROR,
            }).eq('organization_id', job.organizationId)
                .eq('client_id', job.clientId)
                .eq('service', 'ga4')
                .eq('credentials->>property_id', job.property)
                .in('sync_status', ['active', 'error']);
            if (error) fail();
        },
        async markFailed(job) {
            const { error } = await admin.from('client_integrations').update({
                sync_status: 'error',
                error_message: GA4_SYNC_FAILED,
            }).eq('organization_id', job.organizationId)
                .eq('client_id', job.clientId)
                .eq('service', 'ga4')
                .eq('credentials->>property_id', job.property)
                .in('sync_status', ['active', 'error']);
            if (error) fail();
        },
    };
}

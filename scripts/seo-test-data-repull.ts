import { pathToFileURL } from 'node:url';
import { dateOffset, historyWindow, type GscGrain } from '../lib/gsc/history';
import { Ga4AuthError } from '../lib/ga4/run';
import { addUtcDays, utcDay } from '../lib/ga4/sync';
import type { createAdminClient } from '../lib/supabase/admin';
import { GoogleAuthError } from '../lib/sync/token';

type Range = { start: string; end: string };
type Service = 'gsc' | 'ga4';
type Admin = ReturnType<typeof createAdminClient>;
type ConnectedProperty = { organizationId: string; clientId: string; property: string };
type Connection = {
    id: string;
    organization_id: string;
    client_id: string;
    clients: { name: string } | null;
    service: Service;
    site_url: string | null;
    property_id: string | null;
};
type RepullDeps = {
    db: Admin;
    gscV2: string | undefined;
    checkGoogleConfig: () => void;
    repullGsc: (property: ConnectedProperty, range: Range) => Promise<void>;
    repullGa4: (property: ConnectedProperty, range: Range) => Promise<void>;
};

const V2_GRAINS = ['property_device', 'page_device', 'property_country', 'page_organic'] as const;
const GRAINS = ['property', 'page', 'query_page', ...V2_GRAINS] as const satisfies readonly GscGrain[];
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

class RepullError extends Error {
    override name = 'RepullError';
}

function parseArgs(args: readonly string[]) {
    const clientIds = new Set<string>();
    let service: Service | undefined;
    let write = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--write' && !write) {
            write = true;
        } else if (arg === '--client') {
            const value = args[++index];
            if (!value || !UUID.test(value)) throw new RepullError('--client requires a UUID');
            clientIds.add(value.toLowerCase());
        } else if (arg === '--service' && !service) {
            const value = args[++index];
            if (value !== 'gsc' && value !== 'ga4') throw new RepullError('--service requires gsc or ga4');
            service = value;
        } else {
            throw new RepullError('Expected optional --client <uuid> (repeatable), --service gsc|ga4, and --write');
        }
    }
    return { clientIds: [...clientIds], service, write };
}

async function* selectPages<T>(read: (start: number, end: number) => PromiseLike<{
    data: T[] | null;
    error: unknown;
}>, failure: string): AsyncGenerator<T> {
    const pageSize = 500;
    for (let offset = 0; ;) {
        const { data, error } = await read(offset, offset + pageSize - 1);
        if (error) throw new RepullError(failure);
        if (!data?.length) break;
        yield* data;
        offset += data.length;
    }
}

function listConnections(db: Admin, { clientIds, service }: ReturnType<typeof parseArgs>) {
    return selectPages<Connection>((start, end) => {
        const query = db.from('client_integrations')
            .select('id, organization_id, client_id, clients(name), service, site_url:credentials->>site_url, property_id:credentials->>property_id')
            .in('sync_status', ['active', 'error']).in('service', service ? [service] : ['gsc', 'ga4']);
        if (clientIds.length) query.in('client_id', clientIds);
        return query.order('id').range(start, end).overrideTypes<Connection[], { merge: false }>();
    }, 'Unable to list connected clients');
}

type GrainSamples = Record<GscGrain, { grain: GscGrain }[]>;

async function readGscGrains(db: Admin, connection: Connection, range: Range) {
    const grains = new Set<GscGrain>();
    const counts = { v1: 0, v2: 0, empty: 0 };
    // The (day_id, grain, row_key) index lets each embed sample one row per grain.
    // Surface is shared by v1 and v2, so it cannot distinguish the versions.
    const selection = ['id', ...GRAINS.map(grain => `${grain}:gsc_history_facts(grain)`)].join(',');
    const days = selectPages<GrainSamples>((start, end) => {
        const query = db.from('gsc_history_days').select(selection)
            .eq('organization_id', connection.organization_id).eq('client_id', connection.client_id)
            .eq('property', connection.site_url).eq('search_type', 'web')
            .gte('data_date', range.start).lte('data_date', range.end);
        for (const grain of GRAINS) {
            query.eq(`${grain}.grain`, grain).limit(1, { referencedTable: grain });
        }
        return query.order('data_date').range(start, end).overrideTypes<GrainSamples[], { merge: false }>();
    }, 'Unable to read stored GSC grains');
    for await (const day of days) {
        if (GRAINS.some(grain => !Array.isArray(day[grain]))) throw new RepullError('Stored GSC grains could not be verified');
        const present = GRAINS.filter(grain => day[grain].length > 0);
        present.forEach(grain => grains.add(grain));
        if (V2_GRAINS.some(grain => day[grain].length > 0)) counts.v2 += 1;
        else if (present.length) counts.v1 += 1;
        else counts.empty += 1;
    }
    return { grains: GRAINS.filter(grain => grains.has(grain)), ...counts };
}

function checkGscGrains(flag: string | undefined, stored: Awaited<ReturnType<typeof readGscGrains>>) {
    if (flag !== 'true' && flag !== 'false') {
        throw new RepullError('Set GSC_HISTORY_V2_ENABLED explicitly to true or false before writing GSC history');
    }
    const mismatched = flag === 'true' ? stored.v1 : stored.v2;
    if (mismatched > 0) {
        const storedVersion = flag === 'true' ? 'v1-only' : 'v2';
        throw new RepullError(`GSC_HISTORY_V2_ENABLED=${flag} conflicts with ${mismatched} stored ${storedVersion} day(s) in this window`);
    }
}

const SAFE_SYNC_MESSAGES = new Set([
    'Unable to verify history client',
    'Connect and select a GSC property first',
    'GSC property changed',
    'Unable to read GSC landing page settings',
    'Invalid GSC history response',
    'Invalid GSC history metrics',
    'Invalid GSC history dimensions',
    'Invalid GSC property date',
    'GSC pagination repeated a row; retry this day',
    'History was not saved; the connection may have changed. Retry the import.',
    'GA4 quota pause',
    'GA4 re-pull failed',
]);

function safeFailure(error: unknown): string {
    if (error instanceof RepullError) return `${error.name} (${error.message})`;
    if (error instanceof GoogleAuthError || error instanceof Ga4AuthError) {
        const reason = error.kind === 'reauth_required' ? 'reconnect the Google integration' : 'temporary Google authorization failure';
        return `${error instanceof GoogleAuthError ? 'GoogleAuthError' : 'Ga4AuthError'} (${reason})`;
    }
    if (error instanceof Error) {
        if (SAFE_SYNC_MESSAGES.has(error.message) || /^GSC history request failed \(HTTP [1-5][0-9]{2}(, quota)?\)$/.test(error.message)) {
            return `Error (${error.message})`;
        }
        if (error instanceof DOMException && error.name === 'TimeoutError') return 'TimeoutError (request timed out)';
        if (error instanceof TypeError) return 'TypeError (unexpected value or request failure)';
        return 'Error (unexpected sync failure)';
    }
    return 'Unknown error (unexpected sync failure)';
}

export async function runSeoTestRepull(
    args: readonly string[], now: Date, deps?: RepullDeps, log: (message: string) => void = console.log,
): Promise<void> {
    const filters = parseArgs(args);
    const { db, gscV2, checkGoogleConfig, repullGsc, repullGa4 } = deps ?? await liveDeps();
    if (filters.write) checkGoogleConfig();

    const gscToday = historyWindow(now).end;
    const ga4Today = utcDay(now);
    const windows = {
        gsc: { start: dateOffset(gscToday, -30), end: dateOffset(gscToday, -1) },
        ga4: { start: addUtcDays(ga4Today, -30), end: addUtcDays(ga4Today, -1) },
    };
    log(filters.write ? 'Re-pull of matching connections' : 'Dry run of matching connections');
    let matched = 0;
    let failures = 0;
    for await (const connection of listConnections(db, filters)) {
        matched += 1;
        const { id, service, clients, client_id: clientId, organization_id: organizationId } = connection;
        const label = `${service.toUpperCase()} ${JSON.stringify(clients?.name ?? 'Unknown client')} (${clientId}), connection ${id}`;
        const range = windows[service];
        log(`${label} ${range.start} to ${range.end}`);
        try {
            if (service === 'gsc') {
                const property = connection.site_url;
                if (!property) throw new RepullError('Missing GSC property');
                const stored = await readGscGrains(db, connection, range);
                log(`${label} stored GSC grains ${stored.grains.join(', ') || 'none'} (${stored.v1} v1-only, ${stored.v2} v2, ${stored.empty} empty days)`);
                if (!filters.write) continue;
                checkGscGrains(gscV2, stored);
                await repullGsc({ organizationId, clientId, property }, range);
            } else {
                const property = connection.property_id;
                if (!property || !/^properties\/[0-9]+$/.test(property)) throw new RepullError('Invalid GA4 property');
                if (!filters.write) continue;
                await repullGa4({ organizationId, clientId, property }, range);
            }
            log(`${label} complete`);
        } catch (error) {
            failures += 1;
            log(`${label} ${filters.write ? 're-pull failed' : 'preview failed'} (${safeFailure(error)})`);
        }
    }
    if (matched === 0) log('No matching connections');
    if (failures) throw new RepullError(`${failures} connection(s) failed ${filters.write ? 'the re-pull' : 'the preview'}`);
}

async function liveDeps(): Promise<RepullDeps> {
    const { createAdminClient } = await import('../lib/supabase/admin');
    return {
        db: createAdminClient(),
        gscV2: process.env.GSC_HISTORY_V2_ENABLED,
        checkGoogleConfig() {
            if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
                throw new RepullError('Load GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before writing');
            }
        },
        async repullGsc({ organizationId, clientId, property }, range) {
            const { syncGscHistory } = await import('../lib/supabase/gsc-history');
            await syncGscHistory(organizationId, clientId, range, { repullProperty: property });
        },
        async repullGa4(property, range) {
            const { repullGa4History } = await import('../lib/ga4/live');
            await repullGa4History(property, range);
        },
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runSeoTestRepull(process.argv.slice(2), new Date()).catch(error => {
        console.error(safeFailure(error));
        process.exitCode = 1;
    });
}

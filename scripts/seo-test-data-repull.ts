import { pathToFileURL } from 'node:url';
import { dateOffset, historyWindow } from '../lib/gsc/history';
import { addUtcDays, utcDay } from '../lib/ga4/sync';

type Range = { start: string; end: string };
type Windows = { gsc: Range; ga4: Range };

export async function runSeoTestRepull(
    args: readonly string[], now: Date, write = repullConnectedHistory, log = console.log,
): Promise<void> {
    const shouldWrite = args.length === 1 && args[0] === '--write';
    if (args.length && !shouldWrite) throw new Error('Invalid arguments: expected --write');

    const gscToday = historyWindow(now).end;
    const ga4Today = utcDay(now);
    const windows = {
        gsc: { start: dateOffset(gscToday, -30), end: dateOffset(gscToday, -1) },
        ga4: { start: addUtcDays(ga4Today, -30), end: addUtcDays(ga4Today, -1) },
    };
    log(`${shouldWrite ? 'Re-pull' : 'Dry run'} for all connected clients`);
    log(`GSC: ${windows.gsc.start} to ${windows.gsc.end}`);
    log(`GA4: ${windows.ga4.start} to ${windows.ga4.end}`);
    if (shouldWrite) await write(windows);
}

async function repullConnectedHistory(windows: Windows): Promise<void> {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        throw new Error('Load GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before writing');
    }
    const gscV2 = process.env.GSC_HISTORY_V2_ENABLED;
    if (gscV2 !== 'true' && gscV2 !== 'false') {
        throw new Error('Set GSC_HISTORY_V2_ENABLED to the value used by the deployed GSC sync');
    }
    const [{ createAdminClient }, { syncGscHistory }, { repullGa4History }] = await Promise.all([
        import('../lib/supabase/admin'), import('../lib/supabase/gsc-history'), import('../lib/ga4/live'),
    ]);
    const admin = createAdminClient();
    let failures = 0;
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await admin.from('client_integrations')
            .select('id, organization_id, client_id, service, site_url:credentials->>site_url, property_id:credentials->>property_id')
            .in('service', ['gsc', 'ga4']).in('sync_status', ['active', 'error'])
            .order('id').range(offset, offset + pageSize - 1);
        if (error) throw new Error('Unable to list connected clients');
        for (const row of data ?? []) {
            const { organization_id: organizationId, client_id: clientId, service } = row;
            const label = `${service.toUpperCase()} ${clientId}`;
            try {
                if (service === 'gsc') {
                    if (!row.site_url) throw new Error('Missing GSC property');
                    await syncGscHistory(organizationId, clientId, windows.gsc, { repullProperty: row.site_url });
                } else {
                    if (!/^properties\/[0-9]+$/.test(row.property_id ?? '')) throw new Error('Invalid GA4 property');
                    await repullGa4History({ organizationId, clientId, property: row.property_id }, windows.ga4);
                }
                console.log(`${label}: complete`);
            } catch {
                failures += 1;
                console.error(`${label}: re-pull incomplete`);
            }
        }
        if ((data?.length ?? 0) < pageSize) break;
    }
    if (failures) throw new Error(`${failures} connection(s) did not complete the re-pull`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runSeoTestRepull(process.argv.slice(2), new Date()).catch(error => {
        console.error(error instanceof Error ? error.message : 'Re-pull failed');
        process.exitCode = 1;
    });
}

import type { ClientAgreement } from '@/lib/agreements/types';
import { assembleDashboard, type DashboardClientInput } from './portfolio';
import { dashboardWindow } from './range';
import type { SeriesPoint, Totals } from './metrics';
import { addDays } from './range';

function agreement(clientId: string, startsOn: string): ClientAgreement {
    return {
        id: `ag-${clientId}`, organizationId: 'org', clientId, previousId: null, kind: 'initial', title: 'Retainer',
        startsOn, endsOn: null, mode: 'monthly', hours: 40, hoursMode: 'committed', proration: 'full_period',
        timezone: 'America/Los_Angeles', scope: '', services: [], evidence: null, note: null,
        recordedAt: startsOn, recordedBy: 'user', planSnapshot: null,
    };
}

const asOf = '2026-10-07';
const window = dashboardWindow('28d', asOf);

function wave(seed: number, clicks: number, impressions: number, position: number): { totals: Totals; series: SeriesPoint[] } {
    const series: SeriesPoint[] = [];
    let clickSum = 0;
    let impressionSum = 0;
    let weight = 0;
    for (let index = 0; index < 28; index += 1) {
        const swing = 1 + Math.sin((index + seed) / 4) * 0.18;
        const dayClicks = Math.max(0, Math.round((clicks / 28) * swing));
        const dayImpressions = Math.max(0, Math.round((impressions / 28) * swing));
        const dayPosition = position + Math.sin((index + seed) / 5);
        series.push({
            bucket: addDays(window.current.start, index),
            clicks: dayClicks,
            impressions: dayImpressions,
            positionWeight: dayImpressions > 0 ? dayPosition * dayImpressions : null,
        });
        clickSum += dayClicks;
        impressionSum += dayImpressions;
        weight += dayPosition * dayImpressions;
    }
    return {
        totals: { clicks: clickSum, impressions: impressionSum, positionWeight: weight, days: 28 },
        series,
    };
}

function input(patch: Partial<DashboardClientInput> & Pick<DashboardClientInput, 'id' | 'name' | 'domain' | 'property'>): DashboardClientInput {
    return {
        accountManager: 'Abel Miranda',
        seoHours: 40,
        syncStatus: 'active',
        lastSyncedAt: '2026-10-12T18:00:00Z',
        loggedHours: 18,
        agreements: [],
        agreementsKnown: true,
        ...patch,
    };
}

/** Sample portfolio for the dev preview and the render test. Not live data. */
export function exampleDashboard() {
    const north = wave(1, 12400, 210000, 8.4);
    const harbor = wave(2, 4200, 180000, 14.2);
    const bright = wave(3, 8600, 96000, 6.1);
    const summit = wave(4, 3100, 54000, 11.8);
    return assembleDashboard({
        range: '28d',
        window,
        asOf,
        today: '2026-10-14',
        hoursMonth: '2026-10',
        freshness: { latestDataDate: asOf, latestImportedAt: '2026-10-12T18:40:00Z', settling: false },
        clients: [
            input({ id: 'north', name: 'Northline Plumbing', domain: 'northline.example', property: 'sc-domain:northline.example', accountManager: 'Abel Miranda', agreements: [agreement('north', '2026-08-01')] }),
            input({ id: 'harbor', name: 'Harbor Dental', domain: 'harbordental.example', property: 'sc-domain:harbordental.example', accountManager: 'Carlos Morones', loggedHours: 36, agreements: [agreement('harbor', '2026-09-15')] }),
            input({ id: 'bright', name: 'Bright Path Legal', domain: 'brightpath.example', property: 'sc-domain:brightpath.example', accountManager: 'Abel Miranda', loggedHours: 12 }),
            input({ id: 'summit', name: 'Summit Roofing', domain: 'summitroofing.example', property: 'sc-domain:summitroofing.example', accountManager: 'Carlos Morones', loggedHours: 8 }),
            input({ id: 'quiet', name: 'Quiet Studio', domain: 'quietstudio.example', property: 'sc-domain:quietstudio.example', lastSyncedAt: '2026-08-01T00:00:00Z' }),
            input({ id: 'fresh', name: 'Fresh Start Co', domain: 'freshstart.example', property: 'sc-domain:freshstart.example', lastSyncedAt: null, loggedHours: 0 }),
        ],
        aggregates: [
            { clientId: 'north', current: north.totals, previous: { clicks: 11900, impressions: 198000, positionWeight: 8.8 * 198000, days: 28 }, series: north.series, queries: [{ query: 'emergency plumber', clicks: 840 }, { query: 'drain cleaning', clicks: 510 }, { query: 'water heater repair', clicks: 260 }], incomplete: false },
            { clientId: 'harbor', current: harbor.totals, previous: { clicks: 6100, impressions: 240000, positionWeight: 11.4 * 240000, days: 28 }, series: harbor.series, queries: [{ query: 'dentist near me', clicks: 390 }, { query: 'teeth cleaning', clicks: 210 }, { query: 'emergency dentist', clicks: 140 }], incomplete: false },
            { clientId: 'bright', current: bright.totals, previous: { clicks: 5400, impressions: 72000, positionWeight: 9.4 * 72000, days: 28 }, series: bright.series, queries: [{ query: 'business attorney', clicks: 220 }, { query: 'contract lawyer', clicks: 160 }, { query: 'llc formation', clicks: 90 }], incomplete: false },
            { clientId: 'summit', current: summit.totals, previous: { clicks: 2800, impressions: 61000, positionWeight: 13.1 * 61000, days: 28 }, series: summit.series, queries: [{ query: 'roof repair', clicks: 180 }, { query: 'roof replacement', clicks: 120 }, { query: 'leak repair', clicks: 70 }], incomplete: false },
        ],
    });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { dateOffset } from '@/lib/gsc/history.ts';
import type { HistoryDay, HistoryRow } from '@/lib/gsc/insights.ts';
import { pairedWindows, periodMetrics, propertySeries } from '@/lib/search-dashboard/model.ts';
import { loadCampaignMeasurement, type CampaignLoadDeps } from './load.ts';
import { campaignPageResults } from './pages.ts';
import { campaignSitewide } from './sources.ts';
import type { CampaignInitiative } from './initiatives.ts';

const TODAY = '2026-10-29';
const NOW = new Date('2026-10-29T20:00:00Z');

function fixture() {
    const start = dateOffset('2026-10-28', -55);
    const days: HistoryDay[] = [];
    const rows: HistoryRow[] = [];
    for (let index = 0; index < 56; index += 1) {
        const date = dateOffset(start, index);
        const id = `day-${date}`;
        days.push({
            id,
            date,
            importedAt: `${date}T18:00:00Z`,
            pageLimited: false,
            queryLimited: false,
            isIncomplete: false,
        });
        rows.push({
            id: index + 1,
            dayId: id,
            page: '',
            query: '',
            clicks: index < 28 ? 4 : 5,
            impressions: 20,
            position: 6,
        });
    }
    return { days, rows };
}

function deps(
    stored: { days: HistoryDay[]; rows: HistoryRow[] },
    gbpCalls = 8,
    page: { rows: HistoryRow[]; truncated?: boolean } = { rows: [] },
): CampaignLoadDeps {
    return {
        async loadHistory(_clientId, range, grain) {
            assert.ok(grain === 'property' || grain === 'page');
            const days = stored.days.filter(day => day.date >= range.start && day.date <= range.end);
            const ids = new Set(days.map(day => day.id));
            const rows = grain === 'page' ? page.rows : stored.rows;
            return {
                property: 'sc-domain:example.test',
                start: range.start,
                end: range.end,
                grain,
                days,
                missingDates: [],
                rows: rows.filter(row => ids.has(row.dayId)),
                nextOffset: null,
                coverageNote: '',
                truncated: grain === 'page' && page.truncated === true,
            };
        },
        async fetchIntegrations() {
            return { gsc: true, failed: false };
        },
        async readGbp() {
            return [
                { metricMonth: '2026-10', data: { calls: 50 } },
                { metricMonth: '2026-09', data: { calls: gbpCalls } },
                { metricMonth: '2026-08', data: { calls: 3 } },
            ];
        },
        async readApprovals() {
            return 2;
        },
    };
}

test('the loader total matches the Search dashboard helper for the same stored days', async () => {
    const stored = fixture();
    const signal = new AbortController().signal;
    const loaded = await loadCampaignMeasurement({
        organizationId: 'org',
        clientId: 'client',
        signal,
        now: NOW,
    }, deps(stored));
    const direct = campaignSitewide({ connected: true, days: stored.days, rows: stored.rows, today: TODAY });
    const flags = stored.days.map(day => ({ date: day.date, isIncomplete: false }));
    const window = pairedWindows(flags, TODAY);
    assert.ok(window);
    const helper = periodMetrics(propertySeries(stored.days, stored.rows, window.current)).clicks;
    assert.equal(helper, 140);
    assert.equal(direct.clicks, helper);
    assert.equal(loaded.gsc.clicks, helper);
    assert.equal(loaded.gsc.priorClicks, 112);
    assert.equal(loaded.gbp.value, 8);
    assert.equal(loaded.gbp.label, 'Call-button taps');
    assert.equal(loaded.awaitingApproval, 2);
    assert.equal(JSON.stringify(loaded.gsc).includes(String((loaded.gsc.clicks ?? 0) + (loaded.gbp.value ?? 0))), false);
    assert.equal(JSON.stringify(loaded.gbp).includes(String((loaded.gsc.clicks ?? 0) + (loaded.gbp.value ?? 0))), false);
});

test('page-grain clicks are loaded beside sitewide clicks and are not added in', async () => {
    const stored = fixture();
    const pageRows: HistoryRow[] = stored.days.map((day, index) => ({
        id: 1000 + index,
        dayId: day.id,
        page: index % 2 === 0 ? 'https://harbor.example/services/emergency' : 'https://harbor.example/services/emergency?utm_medium=gbp',
        query: '',
        clicks: 3,
        impressions: 4,
        position: 2,
    }));
    const signal = new AbortController().signal;
    const loaded = await loadCampaignMeasurement({
        organizationId: 'org',
        clientId: 'client',
        signal,
        now: NOW,
    }, deps(stored, 8, { rows: pageRows }));
    const initiative: CampaignInitiative = {
        id: 'emergency',
        organizationId: 'org',
        clientId: 'client',
        title: 'Emergency service page',
        purpose: null,
        ownerName: null,
        phase: null,
        category: null,
        targetMonth: null,
        priority: 1,
        state: 'in_progress',
        startsOn: null,
        endsOn: null,
        pageUrl: 'https://harbor.example/services/emergency',
        successMetricLabel: null,
        evidenceUrl: null,
        verifiedOn: null,
        items: [],
    };
    const page = campaignPageResults({ series: loaded.pages, initiatives: [initiative], today: TODAY })[0];
    assert.equal(loaded.gsc.clicks, 140);
    assert.equal(loaded.gbp.value, 8);
    assert.equal(page.clicks, 42);
    assert.equal(page.surface, 'organic');
    assert.equal(JSON.stringify(loaded.gsc).includes('42'), false);
    assert.equal(JSON.stringify(loaded.gbp).includes('42'), false);

    const truncated = await loadCampaignMeasurement({
        organizationId: 'org',
        clientId: 'client',
        signal,
        now: NOW,
    }, deps(stored, 8, { rows: pageRows, truncated: true }));
    const hidden = campaignPageResults({ series: truncated.pages, initiatives: [initiative], today: TODAY })[0];
    assert.equal(truncated.gsc.clicks, 140);
    assert.equal(truncated.gbp.value, 8);
    assert.equal(truncated.pages.status, 'incomplete');
    assert.equal(truncated.pages.rows.length, 0);
    assert.equal(hidden.clicks, null);
});

test('a missing property and a failed Business Profile read stay unmeasured', async () => {
    const signal = new AbortController().signal;
    const loaded = await loadCampaignMeasurement({
        organizationId: 'org',
        clientId: 'client',
        signal,
        now: NOW,
    }, {
        async loadHistory() {
            throw new Error('Select a GSC property first');
        },
        async fetchIntegrations() {
            return { gsc: false, failed: false };
        },
        async readGbp() {
            throw new Error('unavailable');
        },
        async readApprovals() {
            throw new Error('unavailable');
        },
    });
    assert.equal(loaded.gsc.clicks, null);
    assert.equal(loaded.gsc.status, 'not_measurable');
    assert.equal(loaded.gbp.value, null);
    assert.equal(loaded.awaitingApproval, null);
});

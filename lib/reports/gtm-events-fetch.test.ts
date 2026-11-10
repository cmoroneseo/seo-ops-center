import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGtmEvents, ga4PropertyPath, GTM_READ_FAILED_NOTE } from './gtm-events-fetch.ts';
import { DEFAULT_GTM_REPORT_SETTINGS } from './gtm-events.ts';

function report(rows: { dimensions?: Record<string, string>; metrics: Record<string, number> }[]) {
    const dimensionNames = Object.keys(rows[0]?.dimensions ?? {});
    const metricNames = Object.keys(rows[0]?.metrics ?? {});
    return {
        dimensionHeaders: dimensionNames.map(name => ({ name })),
        metricHeaders: metricNames.map(name => ({ name })),
        rows: rows.map(row => ({
            dimensionValues: dimensionNames.map(name => ({ value: row.dimensions?.[name] ?? '' })),
            metricValues: metricNames.map(name => ({ value: String(row.metrics[name] ?? 0) })),
        })),
    };
}

test('the Analytics property path is numeric and the Tag Manager scope gap stays off the snapshot', async () => {
    assert.equal(ga4PropertyPath('542058119'), 'properties/542058119');
    assert.equal(ga4PropertyPath('properties/542058119'), 'properties/542058119');
    assert.throws(() => ga4PropertyPath('GTM-W8Q8SC6V'), /Analytics property/);

    const urls: string[] = [];
    const request: typeof fetch = async (input, init) => {
        const url = String(input);
        urls.push(url);
        assert.equal(new Headers(init?.headers).get('authorization')?.includes('token-secret'), true);
        if (url.endsWith('/metadata')) {
            return Response.json({ dimensions: [{ apiName: 'eventName' }, { apiName: 'linkText' }, { apiName: 'customEvent:property' }] });
        }
        if (url.includes('versions:live')) {
            return Response.json({ error: { status: 'PERMISSION_DENIED', message: 'token-secret' } }, { status: 403 });
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as { dimensions?: { name: string }[]; metrics?: { name: string }[] };
        const dims = (body.dimensions ?? []).map(dimension => dimension.name);
        const metric = body.metrics?.[0]?.name;
        if (metric === 'sessions') return Response.json(report([{ metrics: { sessions: 12 } }]));
        if (dims.includes('date')) return Response.json(report([{ dimensions: { date: '20261001', eventName: 'page_view' }, metrics: { eventCount: 4 } }]));
        if (dims.includes('linkText')) {
            assert.equal(dims.includes('customEvent:property'), true);
            return Response.json(report([{
                dimensions: { eventName: 'property_outbound_click', linkText: 'Allow cookies', linkDomain: 'example.com', linkUrl: '', 'customEvent:property': '(not set)' },
                metrics: { eventCount: 3 },
            }]));
        }
        return Response.json(report([
            { dimensions: { eventName: 'page_view' }, metrics: { eventCount: 4 } },
            { dimensions: { eventName: 'property_outbound_click' }, metrics: { eventCount: 3 } },
        ]));
    };

    const result = await collectGtmEvents({
        fetch: request,
        ga4Token: 'ga4-token-secret',
        propertyId: '542058119',
        gtm: { token: 'gtm-token-secret', accountId: '6361320998', containerId: '255732081' },
        settings: { ...DEFAULT_GTM_REPORT_SETTINGS, excludedLinkTexts: ['Allow cookies'], fallbackEventNames: ['booking_click'] },
        clientName: 'Kentina Hospitality',
        reportMonth: '2026-10',
        now: new Date('2026-11-09T18:00:00.000Z'),
    });

    assert.match(urls.find(url => url.includes(':runReport')) ?? '', /properties\/542058119:runReport$/);
    assert.match(urls.find(url => url.includes('versions:live')) ?? '', /accounts\/6361320998\/containers\/255732081\/versions:live$/);
    assert.equal(result.staffNote, GTM_READ_FAILED_NOTE);
    assert.equal(result.snapshot.kpis.tagEvents.source, 'saved_list');
    assert.equal(JSON.stringify(result.snapshot).includes('token-secret'), false);
    assert.equal(JSON.stringify(result.snapshot).includes('tagmanager.readonly'), false);
    assert.equal(result.snapshot.events.some(row => row.name === 'property_outbound_click'), false);
    assert.equal(result.snapshot.outbound, null);
});

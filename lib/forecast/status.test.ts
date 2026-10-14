import test from 'node:test';
import assert from 'node:assert/strict';
import type { ForecastPayload } from './contract.ts';
import { coveringRun, memberForecastStatus, type ForecastStatusRun } from './status.ts';

const payload = {
    runId: '11111111-1111-4111-8111-111111111111',
    source: 'seo-ops-center',
    organizationId: '22222222-2222-4222-8222-222222222222',
    weeks: [{
        weekStart: '2026-10-12',
        basis: 'actual',
        allocations: [{
            personEmail: 'cmorones@marketingempiregroup.com',
            campaignDeskPersonId: 'desk_carlos',
            clientId: '33333333-3333-4333-8333-333333333333',
            clientName: 'Northwind Plumbing',
            bucket: 'client',
            source: 'actual',
            minutes: 120,
            hours: '2.00',
        }],
    }],
} satisfies ForecastPayload;

function run(minutes: number, createdAt: string): ForecastStatusRun {
    return {
        id: createdAt,
        createdAt,
        createdByName: 'Carlos Morones',
        weekStarts: ['2026-10-12'],
        payload: {
            ...payload,
            weeks: [{
                ...payload.weeks[0],
                allocations: [{ ...payload.weeks[0].allocations[0], minutes, hours: minutes === 120 ? '2.00' : '3.00' }],
            }],
        },
    };
}

test('status is synced, changed, not mapped, or an em dash with a reason', () => {
    const covering = run(120, '2026-10-14T20:00:00.000Z');
    assert.deepEqual(memberForecastStatus({
        match: { status: 'mapped', campaignDeskPersonId: 'desk_carlos' },
        coveringRun: covering,
        previousLines: covering.payload.weeks[0].allocations,
        currentLines: payload.weeks[0].allocations,
        connectionEnabled: true,
    }), { status: 'synced', reason: null });

    assert.equal(memberForecastStatus({
        match: { status: 'mapped', campaignDeskPersonId: 'desk_carlos' },
        coveringRun: run(180, '2026-10-14T20:00:00.000Z'),
        previousLines: run(180, '2026-10-14T20:00:00.000Z').payload.weeks[0].allocations,
        currentLines: payload.weeks[0].allocations,
        connectionEnabled: true,
    }).status, 'changed');

    assert.deepEqual(memberForecastStatus({
        match: { status: 'not_mapped', reason: 'No Campaign Desk person uses this email' },
        coveringRun: covering,
        previousLines: covering.payload.weeks[0].allocations,
        currentLines: payload.weeks[0].allocations,
        connectionEnabled: true,
    }).status, 'not_mapped');

    assert.deepEqual(memberForecastStatus({
        match: { status: 'unknown', reason: 'Campaign Desk is not connected' },
        coveringRun: null,
        previousLines: [],
        currentLines: [],
        connectionEnabled: false,
    }), { status: 'unknown', reason: 'Campaign Desk is not connected' });

    assert.deepEqual(memberForecastStatus({
        match: { status: 'mapped', campaignDeskPersonId: 'desk_carlos' },
        coveringRun: null,
        previousLines: [],
        currentLines: [],
        connectionEnabled: true,
    }), { status: 'unknown', reason: 'Not synced yet' });

    const older = run(120, '2026-10-01T00:00:00.000Z');
    const newer = run(180, '2026-10-14T20:00:00.000Z');
    assert.equal(coveringRun([older, newer], '2026-10-12')?.id, newer.id);
    assert.equal(coveringRun([older], '2026-10-19'), null);
});

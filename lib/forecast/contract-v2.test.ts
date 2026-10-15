import test from 'node:test';
import assert from 'node:assert/strict';
import { ForecastPayloadError, hoursStringFromMinutes } from './contract.ts';
import { parseForecastPayloadV2, parseStoredForecastPayload } from './contract-v2.ts';

const RUN = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const TASK = '44444444-4444-4444-8444-444444444444';
const LOG = '55555555-5555-4555-8555-555555555555';

function item(overrides: Record<string, unknown> = {}) {
    return {
        itemKey: `task:${TASK}:2026-10-13`,
        kind: 'task',
        bucket: 'client',
        client: {
            seoOpsClientId: CLIENT,
            name: 'Pipe It Right',
            domain: 'pipeitright.com',
            campaignDeskClientId: 'rc_pipe',
        },
        title: 'SEO optimizations',
        source: 'actual',
        minutes: 90,
        hours: '1.50',
        startTime: null,
        sourceIds: { taskId: TASK, timeLogIds: [LOG], plannerEventId: null },
        ...overrides,
    };
}

function body(overrides: Record<string, unknown> = {}) {
    return {
        version: 2,
        runId: RUN,
        source: 'seo-ops-center',
        organizationId: ORG,
        weeks: [{
            weekStart: '2026-10-12',
            basis: 'actual',
            people: [{
                personEmail: 'cmorones@marketingempiregroup.com',
                campaignDeskPersonId: 'desk_carlos',
                days: [{ date: '2026-10-13', items: [item()] }],
            }],
        }],
        ...overrides,
    };
}

test('version 2 accepts the contract sample and rejects unknown keys', () => {
    const parsed = parseForecastPayloadV2(body());
    assert.equal(parsed.version, 2);
    assert.equal(parsed.weeks[0].people[0].days[0].items[0].hours, hoursStringFromMinutes(90));
    assert.equal(parsed.weeks[0].weekStart, '2026-10-12');
    assert.throws(() => parseForecastPayloadV2(body({ extra: true })), /extra is not allowed/);
    assert.throws(() => parseForecastPayloadV2(body({ version: '2' })), /version must be the number 2/);
    assert.throws(() => parseForecastPayloadV2(body({ version: 1 })), /version must be the number 2/);
    assert.throws(() => parseStoredForecastPayload(body({ version: 1 })), /omitted or the number 2/);
});

type WeekShape = { people: { days: { items: Record<string, unknown>[] }[] }[] };

test('minutes, hours, basis, monday, and internal client are enforced', () => {
    assert.equal(hoursStringFromMinutes(10), '0.17');
    const badMinutes = structuredClone(body());
    (badMinutes.weeks[0] as WeekShape).people[0].days[0].items[0].minutes = 0;
    assert.throws(() => parseForecastPayloadV2(badMinutes), /1 to 1440/);
    const tooBig = structuredClone(body());
    (tooBig.weeks[0] as WeekShape).people[0].days[0].items[0].minutes = 1441;
    (tooBig.weeks[0] as WeekShape).people[0].days[0].items[0].hours = hoursStringFromMinutes(1441);
    assert.throws(() => parseForecastPayloadV2(tooBig), /1 to 1440/);
    const wrongHours = structuredClone(body());
    (wrongHours.weeks[0] as WeekShape).people[0].days[0].items[0].hours = '1.51';
    assert.throws(() => parseForecastPayloadV2(wrongHours), /hours must equal minutes/);
    const wrongSource = structuredClone(body());
    (wrongSource.weeks[0] as WeekShape).people[0].days[0].items[0].source = 'estimate';
    assert.throws(() => parseForecastPayloadV2(wrongSource), /source must match basis/);
    const sunday = structuredClone(body());
    (sunday.weeks[0] as { weekStart: string }).weekStart = '2026-10-13';
    assert.throws(() => parseForecastPayloadV2(sunday), /Monday/);
    const internal = structuredClone(body());
    const line = (internal.weeks[0] as WeekShape).people[0].days[0].items[0];
    line.bucket = 'internal';
    line.client = { seoOpsClientId: CLIENT, name: 'Pipe It Right', domain: null, campaignDeskClientId: null };
    assert.throws(() => parseForecastPayloadV2(internal), /client must be null when bucket is internal/);
    line.client = null;
    line.itemKey = `event:${TASK}:2026-10-13`;
    line.kind = 'event';
    const accepted = parseForecastPayloadV2(internal);
    assert.equal(accepted.weeks[0].people[0].days[0].items[0].client, null);
    assert.throws(() => parseForecastPayloadV2({}), ForecastPayloadError);
});

test('a missing domain is stored as null and version 1 still parses', () => {
    const payload = structuredClone(body());
    const client = (payload.weeks[0] as {
        people: { days: { items: { client: Record<string, unknown> }[] }[] }[];
    }).people[0].days[0].items[0].client;
    delete client.domain;
    const parsed = parseForecastPayloadV2(payload);
    assert.equal(parsed.weeks[0].people[0].days[0].items[0].client?.domain, null);
    const v1 = parseStoredForecastPayload({
        runId: RUN,
        source: 'seo-ops-center',
        organizationId: ORG,
        weeks: [{ weekStart: '2026-10-12', basis: 'actual', allocations: [] }],
    });
    assert.equal('version' in v1, false);
});

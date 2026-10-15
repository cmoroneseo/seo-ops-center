import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    forecastPayloadHash,
    hoursStringFromMinutes,
    parseForecastPayload,
    ForecastPayloadError,
} from './contract.ts';

test('hours stay a two-decimal string tied to integer minutes', () => {
    assert.equal(hoursStringFromMinutes(0), '0.00');
    assert.equal(hoursStringFromMinutes(60), '1.00');
    assert.equal(hoursStringFromMinutes(90), '1.50');
    assert.equal(hoursStringFromMinutes(240), '4.00');
    assert.equal(hoursStringFromMinutes(10), '0.17');
    assert.equal(hoursStringFromMinutes(241), '4.02');
    assert.throws(() => hoursStringFromMinutes(1.5), ForecastPayloadError);
});

test('the handoff sample is the payload SEO Ops sends', () => {
    const doc = readFileSync(new URL('../../docs/campaign-desk-sync-handoff.md', import.meta.url), 'utf8');
    const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map(match => match[1]);
    const sample = blocks.find(block => block.includes('"source": "seo-ops-center"'));
    assert.ok(sample);
    const payload = parseForecastPayload(JSON.parse(sample));
    assert.equal(payload.weeks.length, 2);
    assert.equal(payload.weeks[0].basis, 'actual');
    assert.equal(payload.weeks[1].basis, 'estimate');
    assert.equal(payload.weeks[0].allocations[1].bucket, 'internal');
    assert.equal(payload.weeks[0].allocations[1].clientId, null);
    assert.equal(payload.weeks[0].allocations[0].hours, '4.00');
    assert.equal(forecastPayloadHash(payload), forecastPayloadHash({
        source: payload.source,
        organizationId: payload.organizationId,
        weeks: payload.weeks,
    }));

    assert.throws(() => parseForecastPayload({ ...payload, weeks: [{
        ...payload.weeks[0],
        allocations: [{ ...payload.weeks[0].allocations[0], hours: '4.01' }],
    }] }), /hours must match minutes/);
    assert.throws(() => parseForecastPayload({
        ...payload,
        weeks: [{
            ...payload.weeks[0],
            allocations: [{ ...payload.weeks[0].allocations[1], clientId: payload.weeks[0].allocations[0].clientId }],
        }],
    }), /internal allocations have no client id/);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBotTimeRequest } from './request.ts';

const NOW = new Date('2026-11-03T18:00:00.000Z');
const CLIENT = '33333333-3333-4333-8333-333333333333';

function body(patch: Record<string, unknown> = {}) {
    return {
        idempotencyKey: 'ecoworkz-brief-2026-11-03',
        clientId: CLIENT,
        taskTitle: 'Write the Ecoworkz brief',
        date: '2026-11-03',
        minutes: 45,
        ...patch,
    };
}

test('minutes become hours and a past completion lands at midday', () => {
    const parsed = parseBotTimeRequest(body({
        complete: true,
        completedOn: '2026-11-02',
        timeZone: 'America/Los_Angeles',
        referenceLink: 'https://docs.google.com/document/d/brief',
        countsTowardBudget: false,
    }), NOW);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.command.hours, 0.75);
    assert.equal(parsed.command.minutes, 45);
    assert.equal(parsed.command.countsTowardBudget, false);
    assert.equal(parsed.command.referenceLink?.url, 'https://docs.google.com/document/d/brief');
    assert.equal(parsed.command.completedAt, '2026-11-02T20:00:00.000Z');
    const again = parseBotTimeRequest(body({
        complete: true,
        completedOn: '2026-11-02',
        timeZone: 'America/Los_Angeles',
        referenceLink: 'https://docs.google.com/document/d/brief',
        countsTowardBudget: false,
    }), NOW);
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.command.requestHash, parsed.command.requestHash);
});

test('a future completion date and a javascript link are rejected', () => {
    const future = parseBotTimeRequest(body({ complete: true, completedOn: '2026-11-04' }), NOW);
    assert.equal(future.ok, false);
    if (!future.ok) assert.equal(future.code, 'completion_date');

    const script = parseBotTimeRequest(body({ referenceLink: 'javascript:alert(1)' }), NOW);
    assert.equal(script.ok, false);
    if (!script.ok) assert.equal(script.status, 400);
});

test('delete, settings, and a caller-supplied user id are out of scope', () => {
    for (const extra of [{ delete: true }, { settings: { theme: 'x' } }, { userId: CLIENT }, { action: 'remove' }]) {
        const parsed = parseBotTimeRequest(body(extra), NOW);
        assert.equal(parsed.ok, false);
        if (!parsed.ok) assert.equal(parsed.status, 403);
    }
});

test('a category is a single line, and a client label is not rejected here', () => {
    const seo = parseBotTimeRequest(body({ category: 'SEO' }), NOW);
    assert.equal(seo.ok, true);
    if (seo.ok) assert.equal(seo.command.category, 'SEO');

    const technical = parseBotTimeRequest(body({ category: 'technical' }), NOW);
    assert.equal(technical.ok, true);

    const listTitle = parseBotTimeRequest(body({ category: "SEO Campaign To-Do's" }), NOW);
    assert.equal(listTitle.ok, true);
    if (listTitle.ok) assert.equal(listTitle.command.category, "SEO Campaign To-Do's");

    const omitted = parseBotTimeRequest(body(), NOW);
    assert.equal(omitted.ok, true);
    if (omitted.ok) assert.equal(omitted.command.category, undefined);

    const blank = parseBotTimeRequest(body({ category: '   ' }), NOW);
    assert.equal(blank.ok, false);

    const broken = parseBotTimeRequest(body({ category: 'SEO\nPlan' }), NOW);
    assert.equal(broken.ok, false);

    const huge = parseBotTimeRequest(body({ category: 'S'.repeat(81) }), NOW);
    assert.equal(huge.ok, false);
    if (!huge.ok) assert.match(huge.error, /80 characters/);

    const number = parseBotTimeRequest(body({ category: 1 }), NOW);
    assert.equal(number.ok, false);
});

test('minutes and hours that disagree are rejected', () => {
    const parsed = parseBotTimeRequest(body({ minutes: 45, hours: 2 }), NOW);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.error, /same amount/);
});

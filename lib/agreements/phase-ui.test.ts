import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgreementTimeline } from '../../components/seo-plan/AgreementTimeline.tsx';
import { buildTimeline } from './phase.ts';
import type { ClientAgreement } from './types.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const agreement: ClientAgreement = {
    id: 'root', organizationId: 'org', clientId: 'client', previousId: null, kind: 'initial', title: 'Retainer',
    startsOn: '2026-10-01', endsOn: null, mode: 'monthly', hours: 10, hoursMode: 'committed', proration: 'daily',
    timezone: 'America/Los_Angeles', scope: 'SEO', services: [], evidence: null, note: null, recordedAt: '2026-10-01',
    recordedBy: 'user', planSnapshot: null,
};

test('the roadmap renders a slipped card in the current month and an em dash when hours are unknown', () => {
    const model = buildTimeline({
        work: [{
            id: 'item', title: 'Rank tracking', owner: 'Mei',
            task: { id: 'rank', title: 'Rank tracking', status: 'todo', dueDate: '2026-10-18', estimatedHours: 6 },
        }],
        agreements: [agreement], agreementsFailed: false, today: '2026-11-15', logs: null, logsFailed: true,
    });
    const html = renderToStaticMarkup(createElement(AgreementTimeline, { model }));
    assert.match(html, /Slipped · was Month 1/);
    assert.match(html, /Oct 18/);
    assert.match(html, /Month 2 · Nov 2026/);
    assert.match(html, /Planned 6h · Delivered —/);
    assert.equal(html.includes('0.0h'), false);
    assert.equal(html.includes('basecamp'), false);
});

test('an unphased task renders in Month columns with a slipped label and no calendar-only column', () => {
    const model = buildTimeline({
        work: [{
            id: 'item', title: 'Pre-088 task',
            task: { id: 'old', title: 'Pre-088 task', status: 'todo', dueDate: '2026-10-18', planPhase: null, planPhaseLocked: false },
        }],
        agreements: [agreement], agreementsFailed: false, today: '2026-11-15', logs: [], logsFailed: false,
    });
    const html = renderToStaticMarkup(createElement(AgreementTimeline, { model }));
    assert.match(html, /Onboarding/);
    assert.match(html, /Month 1 · Oct 2026/);
    assert.match(html, /Month 2 · Nov 2026/);
    assert.match(html, /Slipped · was Month 1/);
    assert.equal(html.includes('>Oct 2026<'), false);
});

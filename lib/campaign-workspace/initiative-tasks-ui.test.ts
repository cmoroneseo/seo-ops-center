import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RoadmapPanel } from '../../components/campaign-workspace/RoadmapPanel.tsx';
import type { CampaignInitiative } from './initiatives.ts';
import type { PartOfTask } from '../tasks/part-of.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const rank = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const initiative: CampaignInitiative = {
    id: rank,
    organizationId: '11111111-1111-4111-8111-111111111111',
    clientId: '33333333-3333-4333-8333-333333333333',
    title: 'Rank the service pages',
    purpose: 'Help patients find the service',
    ownerName: 'Alex Kim',
    phase: 'growth',
    category: 'on_page',
    targetMonth: 2,
    priority: 1,
    state: 'in_progress',
    startsOn: '2026-09-01',
    endsOn: '2026-11-20',
    pageUrl: 'https://harbor.example/services',
    successMetricLabel: 'Service page clicks',
    evidenceUrl: null,
    verifiedOn: null,
    items: [],
};

function render(links: readonly PartOfTask[]) {
    return renderToStaticMarkup(createElement(RoadmapPanel, {
        initiatives: [initiative],
        today: '2026-11-07',
        message: null,
        selectedId: rank,
        onSelect() {},
        onSaved() {},
        links,
    }));
}

test('linked tasks show a count and an unlinked row keeps its manual fields', () => {
    const quiet = render([]);
    assert.match(quiet, /Rank the service pages/);
    assert.match(quiet, /Help patients find the service/);
    assert.match(quiet, /Growth/);
    assert.equal(quiet.includes('tasks done'), false);
    assert.equal(quiet.includes('data-linked-task'), false);
    assert.equal(/\d+ of \d+/.test(quiet), false);

    const html = render([
        { id: 'page', title: 'Rewrite the service page', status: 'todo', parentTaskId: null, initiativeId: rank },
        { id: 'proof', title: 'Publish the proof', status: 'done', parentTaskId: null, initiativeId: rank },
        { id: 'heading', title: 'Check one heading', status: 'done', parentTaskId: 'page', initiativeId: rank },
    ]);
    assert.match(html, /1 of 2 tasks done/);
    assert.match(html, /data-linked-task="page"/);
    assert.match(html, /Rewrite the service page/);
    assert.match(html, /Publish the proof/);
    assert.equal(html.includes('Check one heading'), false);
    assert.match(html, /Help patients find the service/);
    assert.equal(html.includes('>initiative<'), false);
    assert.equal(html.includes('pillar'), false);
});

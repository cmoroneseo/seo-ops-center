import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { SearchInvestigation } from '../types';
import { kindForEvidenceCategory } from './investigations.ts';
import {
    mapInvestigationsByIdentity,
    investigationTaskHandoff,
    InvestigationEvidenceCard,
} from '../../components/workspace/SearchInsightsTab.tsx';

const dismissed: SearchInvestigation = {
    id: 'inv-1',
    organizationId: 'org-1',
    clientId: 'client-1',
    property: 'sc-domain:ecoworkz.net',
    kind: 'query_page',
    identityKey: 'hash',
    query: 'hardscape contractor',
    page: 'https://www.ecoworkz.net/corona-ca/',
    status: 'dismissed',
    dismissalReason: 'insufficient_evidence',
    evidenceSnapshot: {
        version: 1,
        category: 'deeper_visibility',
        property: 'sc-domain:ecoworkz.net',
        start: '2026-09-01',
        end: '2026-09-07',
        query: 'hardscape contractor',
        page: 'https://www.ecoworkz.net/corona-ca/',
        clicks: 0,
        impressions: 237,
        ctr: 0,
        position: 33,
        observedDays: 7,
        limitations: ['Observed visibility is not proof of a ranking opportunity.'],
    },
    statusHistory: [],
    createdAt: '2026-09-11T00:00:00Z',
    updatedAt: '2026-09-11T00:00:00Z',
};

test('evidence categories map to stable semantic investigation kinds', () => {
    assert.equal(kindForEvidenceCategory('near_page_one'), 'query_page');
    assert.equal(kindForEvidenceCategory('deeper_visibility'), 'query_page');
    assert.equal(kindForEvidenceCategory('page_visibility'), 'page');
    assert.equal(kindForEvidenceCategory('overlapping_urls'), 'overlap');
});

test('dismissed evidence retains its observed metrics beside the decision', () => {
    const html = renderToStaticMarkup(createElement(InvestigationEvidenceCard, {
        summary: createElement('span', null, '237 impressions · Position 33.0'),
        decision: dismissed,
        busy: false,
        workflowDisabled: false,
        onCreateTask() {},
        onDismiss() {},
        onRestore() {},
    }, createElement('p', null, 'Observed on 7 saved days.')));

    assert.match(html, /237 impressions/);
    assert.match(html, /Position 33\.0/);
    assert.match(html, /Observed on 7 saved days/);
    assert.match(html, /Dismissed/);
    assert.match(html, /Insufficient evidence/);
});

test('task handoff carries the investigation identity and evidence-conscious defaults', () => {
    const handoff = investigationTaskHandoff({ ...dismissed, status: 'open', dismissalReason: undefined }, 'Ecoworkz');

    assert.equal(handoff.sourceInvestigationId, 'inv-1');
    assert.equal(handoff.defaultCategory, 'strategy');
    assert.equal(handoff.defaultPriority, 'medium');
    assert.deepEqual(handoff.defaultTags, ['gsc', 'search-insights']);
    assert.match(handoff.defaultTitle, /hardscape contractor/i);
    assert.match(handoff.defaultDescription, /No ranking gain is predicted/);
});

test('a malformed persisted URL cannot crash otherwise valid workflow decisions', () => {
    const decisions = mapInvestigationsByIdentity([
        dismissed,
        { ...dismissed, id: 'invalid', page: 'https://[' },
    ], 'sc-domain:ecoworkz.net');

    assert.equal(decisions.size, 1);
    assert.equal(decisions.values().next().value?.id, 'inv-1');
});

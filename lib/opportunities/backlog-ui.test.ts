import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

import { OpportunityBacklogTable, type OpportunityBacklogViewRow } from '../../components/opportunities/OpportunityBacklog.tsx';
import type { SearchInvestigation } from '../types';
import type { ScoredOpportunity } from './score';

const noop = () => {};

function row(overrides: Partial<ScoredOpportunity> = {}): ScoredOpportunity {
    return {
        id: 'improve_ranking\u001fpatio ideas\u001fhttps://example.com/patios',
        actionType: 'improve_ranking',
        actionLabel: 'Improve ranking',
        score: 75,
        impact: 'high',
        effort: 'medium',
        estClicks: null,
        page: 'https://example.com/patios',
        query: 'patio ideas',
        evidence: '“patio ideas” averaged position 8.0 over 12 saved days, with 1,000 impressions and 18 clicks.',
        investigation: {
            category: 'near_page_one',
            evidence: {
                query: 'patio ideas',
                page: 'https://example.com/patios',
                clicks: 18,
                impressions: 1000,
                position: 8,
                ctr: 0.018,
                observedDays: 12,
            },
        },
        ...overrides,
    };
}

function view(item: ScoredOpportunity, decision?: SearchInvestigation): OpportunityBacklogViewRow {
    return { item, decision, decisionKey: decision ? 'key' : 'key', busy: false };
}

const dismissed: SearchInvestigation = {
    id: 'inv-1',
    organizationId: 'org',
    clientId: 'client',
    property: 'sc-domain:example.com',
    kind: 'query_page',
    identityKey: 'hash',
    query: 'patio ideas',
    page: 'https://example.com/patios',
    status: 'dismissed',
    dismissalReason: 'insufficient_evidence',
    evidenceSnapshot: {
        version: 1,
        category: 'near_page_one',
        property: 'sc-domain:example.com',
        start: '2026-09-01',
        end: '2026-09-28',
        query: 'patio ideas',
        page: 'https://example.com/patios',
        clicks: 18,
        impressions: 1000,
        ctr: 0.018,
        position: 8,
        observedDays: 12,
        limitations: ['Observed visibility is not proof of a ranking opportunity.'],
    },
    statusHistory: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
};

function render(rows: OpportunityBacklogViewRow[], queue: 'active' | 'completed' | 'dismissed' = 'active') {
    return renderToStaticMarkup(createElement(OpportunityBacklogTable, {
        queue,
        counts: { active: queue === 'active' ? rows.length : 0, completed: 0, dismissed: queue === 'dismissed' ? rows.length : 0 },
        rows,
        notes: [],
        loading: false,
        error: '',
        workflowDisabled: false,
        windowLabel: '28 days · 2026-09-01 – 2026-09-28',
        onQueue: noop,
        onReload: noop,
        onCreateTask: noop,
        onDismiss: noop,
        onRestore: noop,
        organizationId: 'org',
        clientId: 'client',
    }));
}

test('the backlog table shows a score, the action, and an em dash for null est. clicks', () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
    try {
        const html = render([
            view(row()),
            view(row({
                id: 'add_h1',
                actionType: 'add_h1',
                actionLabel: 'Add H1',
                score: 16,
                impact: null,
                effort: 'low',
                query: null,
                page: 'https://example.com/guide',
                evidence: 'No H1 was observed on this indexable page.',
                investigation: null,
            })),
        ]);
        assert.match(html, /aria-label="Backlog status"/);
        assert.match(html, />Score</);
        assert.match(html, />Action</);
        assert.match(html, />Page\/Query</);
        assert.match(html, />Impact</);
        assert.match(html, />Effort</);
        assert.match(html, />Est\. clicks</);
        assert.match(html, />Evidence</);
        assert.match(html, />Improve ranking</);
        assert.match(html, />75</);
        assert.match(html, /data-est-clicks="—"/);
        assert.match(html, />High</);
        assert.match(html, />Medium</);
        assert.match(html, />Add H1</);
        assert.match(html, />Low</);
        assert.match(html, /data-track-query="patio ideas"/);
        const heading = html.slice(html.indexOf('Add H1'));
        assert.equal(heading.includes('data-track-query'), false);
        assert.match(html, />—</);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

test('a dismissed investigation stays in the backlog with its reason', () => {
    const html = render([view(row(), dismissed)], 'dismissed');
    assert.match(html, /Dismissed/);
    assert.match(html, /Insufficient evidence/);
    assert.match(html, /1,000 impressions/);
    assert.match(html, /aria-pressed="true"/);
});

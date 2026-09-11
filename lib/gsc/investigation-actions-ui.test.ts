import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { SearchInvestigation } from '../types';
import {
    DismissInvestigationDialog,
    SEARCH_DISMISSAL_REASON_LABELS,
    SearchInvestigationActions,
} from '../../components/workspace/SearchInvestigationActions.tsx';

const baseInvestigation: SearchInvestigation = {
    id: 'inv-1',
    organizationId: 'org-1',
    clientId: 'client-1',
    property: 'sc-domain:ecoworkz.net',
    kind: 'query_page',
    identityKey: 'hash',
    query: 'hardscape contractor',
    page: 'https://www.ecoworkz.net/corona-ca/',
    status: 'open',
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

const handlers = {
    onCreateTask() {},
    onDismiss() {},
    onRestore() {},
};

test('open or unrecorded evidence offers task creation and dismissal', () => {
    const openHtml = renderToStaticMarkup(createElement(SearchInvestigationActions, {
        decision: baseInvestigation,
        busy: false,
        ...handlers,
    }));
    const unrecordedHtml = renderToStaticMarkup(createElement(SearchInvestigationActions, {
        busy: false,
        ...handlers,
    }));

    for (const html of [openHtml, unrecordedHtml]) {
        assert.match(html, />Create task</);
        assert.match(html, />Dismiss</);
    }
});

test('dismissed evidence stays actionable through its reason and restore control', () => {
    const html = renderToStaticMarkup(createElement(SearchInvestigationActions, {
        decision: {
            ...baseInvestigation,
            status: 'dismissed',
            dismissalReason: 'insufficient_evidence',
            dismissalNote: 'Review after crawl.',
        },
        busy: false,
        ...handlers,
    }));

    assert.match(html, /Dismissed/);
    assert.match(html, /Insufficient evidence/);
    assert.match(html, /Review after crawl\./);
    assert.match(html, />Restore</);
    assert.doesNotMatch(html, />Create task</);
});

test('task-created evidence names the linked task and removes decision controls', () => {
    const html = renderToStaticMarkup(createElement(SearchInvestigationActions, {
        decision: {
            ...baseInvestigation,
            status: 'task_created',
            taskId: 'task-1',
            linkedTask: { id: 'task-1', title: 'Investigate evidence', status: 'todo' },
        },
        busy: false,
        ...handlers,
    }));

    assert.match(html, /Task created/);
    assert.match(html, /Investigate evidence/);
    assert.match(html, /To do/);
    assert.doesNotMatch(html, />Create task</);
    assert.doesNotMatch(html, />Dismiss</);
});

test('busy actions are disabled and expose mutation status', () => {
    const html = renderToStaticMarkup(createElement(SearchInvestigationActions, {
        decision: baseInvestigation,
        busy: true,
        ...handlers,
    }));

    assert.match(html, /Saving investigation decision/);
    assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
});

test('dismissal dialog exposes every approved reason and requires a selection', () => {
    const html = renderToStaticMarkup(createElement(DismissInvestigationDialog, {
        isOpen: true,
        busy: false,
        onCancel() {},
        onConfirm() {},
    }));

    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /maxLength="1000"/);
    assert.match(html, /disabled=""[^>]*>Confirm dismissal</);
    for (const label of Object.values(SEARCH_DISMISSAL_REASON_LABELS)) {
        assert.match(html, new RegExp(label));
    }
});

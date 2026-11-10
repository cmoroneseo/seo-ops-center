import test from 'node:test';
import assert from 'node:assert/strict';

import {
    freshnessValue,
    opportunityMonthRange,
    opportunityViews,
    parseOpportunityRange,
    readOpportunityRoute,
    withOpportunityRange,
    withOpportunityView,
} from './view.ts';

const on = { keywordTracking: true };
const off = { keywordTracking: false };

test('search and insights open Performance, and inventory and rankings keep their tabs', () => {
    assert.deepEqual(readOpportunityRoute('?tab=search', off), {
        tab: 'insights',
        view: 'performance',
        rewrite: '?tab=insights',
    });
    assert.deepEqual(readOpportunityRoute('tab=insights', off), {
        tab: 'insights',
        view: 'performance',
        rewrite: null,
    });
    assert.deepEqual(readOpportunityRoute('?tab=insights&view=backlog', off), {
        tab: 'insights',
        view: 'backlog',
        rewrite: null,
    });
    assert.deepEqual(readOpportunityRoute('?tab=inventory', off), {
        tab: 'inventory',
        view: 'health',
        rewrite: null,
    });
    assert.deepEqual(readOpportunityRoute('?tab=inventory&view=backlog&range=7d', off), {
        tab: 'inventory',
        view: 'health',
        rewrite: '?tab=inventory&range=7d',
    });
    assert.deepEqual(readOpportunityRoute('?tab=rankings', on), {
        tab: 'rankings',
        view: 'rankings',
        rewrite: null,
    });
    assert.deepEqual(readOpportunityRoute('?tab=rankings', off), {
        tab: null,
        view: 'performance',
        rewrite: null,
    });
    assert.equal(readOpportunityRoute('?tab=overview', on).tab, null);
});

test('a rankings sub-view is dropped unless keyword tracking is on', () => {
    assert.equal(readOpportunityRoute('?tab=search&view=rankings', off).tab, 'insights');
    assert.equal(readOpportunityRoute('?tab=search&view=rankings', off).view, 'performance');
    assert.equal(readOpportunityRoute('?tab=insights&view=rankings', on).tab, 'rankings');
    assert.equal(readOpportunityRoute('?tab=insights&view=health', off).tab, 'inventory');
    assert.equal(readOpportunityRoute('?tab=insights&view=site-health', off).view, 'health');
    assert.equal(readOpportunityRoute('?tab=insights&view=nope', off).view, 'performance');
    assert.deepEqual(opportunityViews(false).map(item => item.label), ['Performance', 'Backlog', 'Site health']);
    assert.deepEqual(opportunityViews(true).map(item => item.id), ['performance', 'backlog', 'rankings', 'health']);
});

test('sub-view links keep the range and the existing tab names', () => {
    assert.equal(
        withOpportunityView('?tab=insights&range=90d', 'backlog', off),
        '?tab=insights&range=90d&view=backlog',
    );
    assert.equal(withOpportunityView('?tab=insights&view=backlog', 'performance', off), '?tab=insights');
    assert.equal(withOpportunityView('?tab=search', 'health', off), '?tab=inventory');
    assert.equal(withOpportunityView('?tab=insights', 'rankings', on), '?tab=rankings');
    assert.equal(withOpportunityView('?tab=insights', 'rankings', off), '?tab=insights');
});

test('the range toggle accepts 7, 28, and 90 days and leaves a month key alone', () => {
    assert.equal(parseOpportunityRange(null), 28);
    assert.equal(parseOpportunityRange('28d'), 28);
    assert.equal(parseOpportunityRange('7d'), 7);
    assert.equal(parseOpportunityRange('90d'), 90);
    assert.equal(parseOpportunityRange('2026-08'), 28);
    assert.equal(parseOpportunityRange('TRUE'), 28);
    assert.equal(opportunityMonthRange('2026-08'), '2026-08');
    assert.equal(opportunityMonthRange('7d'), null);
    assert.equal(withOpportunityRange('?tab=insights', 7), '?tab=insights&range=7d');
    assert.equal(withOpportunityRange('?tab=insights&range=7d', 90), '?tab=insights&range=90d');
    assert.equal(withOpportunityRange('?tab=insights&range=90d', 28), '?tab=insights');
    assert.equal(withOpportunityRange('?tab=insights&range=2026-08', 28), '?tab=insights&range=2026-08');
    assert.equal(withOpportunityRange('?tab=insights&range=2026-08', 7), '?tab=insights&range=7d');
});

test('a missing freshness value stays an em dash', () => {
    assert.equal(freshnessValue(null), '—');
    assert.equal(freshnessValue(undefined), '—');
    assert.equal(freshnessValue(''), '—');
    assert.equal(freshnessValue('  '), '—');
    assert.equal(freshnessValue(0), '—');
    assert.equal(freshnessValue('Not final'), 'Not final');
});

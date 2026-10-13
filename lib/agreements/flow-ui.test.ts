import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgreementHistoryHeading, AgreementHistoryPanel } from '../../components/workspace/agreements/AgreementHistoryDialog.tsx';
import { AgreementOutputGroups, AgreementReviewScopeNote, AgreementServiceFields, AllowanceComparison } from '../../components/workspace/agreements/AgreementFlow.tsx';
import { allowanceReconciliation, historicalHoursNote, monthCoverageLines } from './logic.ts';
import type { AgreementInput, AgreementService } from './types.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const blogs: AgreementService = { sourceId: 'blog', title: 'Blog Posts', type: 'Content', quantity: 4, cadence: 'monthly', countsTowardHours: true };

test('carried-over deliverable rows are labeled and can be removed', () => {
    const html = renderToStaticMarkup(createElement(AgreementServiceFields, {
        kind: 'initial',
        mode: 'monthly',
        services: [blogs],
        onChange: () => undefined,
    }));
    assert.match(html, /Prefilled from the current setup/);
    assert.doesNotMatch(html, /Deliverables carried over from the current setup/);
    assert.doesNotMatch(html, /Scope carried over from the current setup/);
    assert.match(html, /aria-label="Remove Blog Posts"/);
    assert.match(html, />Remove</);
    const button = html.match(/<button[^>]*aria-label="Remove Blog Posts"[^>]*>/)?.[0] ?? '';
    assert.doesNotMatch(button, /(?:^|\s)disabled(?:=|\s|>)/);
    const name = html.match(/<input[^>]*aria-label="Output 1 name"[^>]*>/)?.[0] ?? '';
    assert.match(name, /disabled/);
});

test('original review lists prefilled outputs as carried over and flags an hours mismatch', () => {
    const groups = renderToStaticMarkup(createElement(AgreementOutputGroups, {
        kind: 'initial',
        kept: [],
        renamed: [],
        carried: ['4 Blog Posts · Content · per month · consumes SEO hours'],
        added: [],
        stopped: [],
    }));
    assert.match(groups, /Deliverables carried over from the current setup/);
    assert.doesNotMatch(groups, /Prefilled from the current setup/);
    assert.doesNotMatch(groups, /Scope carried over from the current setup/);
    const scope = renderToStaticMarkup(createElement(AgreementReviewScopeNote));
    assert.match(scope, /Scope carried over from the current setup/);
    assert.equal(scope.includes('Deliverables carried over'), false);
    assert.match(groups, /4 Blog Posts · Content · per month · consumes SEO hours/);
    const added = groups.split('Added')[1] ?? '';
    assert.match(added, /None/);
    assert.equal(added.includes('Blog Posts'), false);

    const mismatch = allowanceReconciliation({ mode: 'monthly', hours: 30 }, { mode: 'monthly', hours: 20 });
    const banner = renderToStaticMarkup(createElement(AllowanceComparison, { allowance: mismatch }));
    assert.match(banner, /Current setup: 30h \/ month → Agreement: 20h \/ month/);
    assert.match(banner, /Current setup and this agreement use different hours/);

    const input: AgreementInput = {
        kind: 'initial', previousId: null, title: 'Original agreement', startsOn: '2026-03-01', endsOn: null,
        mode: 'monthly', hours: 10, hoursMode: 'committed', proration: 'daily', timezone: 'America/Los_Angeles',
        scope: '4x/month', services: [], evidence: null, note: null, fundedTaskIds: [],
    };
    assert.equal(monthCoverageLines([], input)[0].text, 'Mar 1–31 · 10h retainer');
    const note = historicalHoursNote({
        hours: 148.27, startsOn: '2026-03-19', endsOn: null, agreementTitle: 'Original agreement', previousTitle: null, kind: 'initial',
    });
    assert.match(note, /count against Original agreement/);
    assert.match(note, /Budgets for those months will follow the recorded terms/);
});

test('agreement history heading opens history and the empty state is explicit', () => {
    const heading = renderToStaticMarkup(createElement(AgreementHistoryHeading, {
        label: 'Agreement history',
        onOpen: () => undefined,
    }));
    assert.match(heading, /<button/);
    assert.match(heading, /aria-haspopup="dialog"/);
    assert.match(heading, />Agreement history</);

    const empty = renderToStaticMarkup(createElement(AgreementHistoryPanel, {
        history: [],
        today: '2026-10-13',
        canManage: true,
        busy: false,
        error: null,
        onChangeScope: () => undefined,
        onCancel: async () => undefined,
    }));
    assert.match(empty, /No agreement recorded yet/);
});

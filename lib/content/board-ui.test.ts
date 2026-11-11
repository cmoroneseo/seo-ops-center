import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ApproveForMonth } from '../../components/content/ApproveForMonth.tsx';
import { ContentBoardView } from '../../components/content/ContentBoard.tsx';
import { RecordDetailPanel } from '../../components/topical-map/RecordDetailPanel.tsx';
import { contentQuota } from './quota.ts';
import type { ContentBoardRecord } from './board.ts';
import type { TopicalMapRecord, TopicalMapSilo } from '../types.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function page(overrides: Partial<ContentBoardRecord> = {}): ContentBoardRecord {
    return {
        id: 'page-1',
        title: 'Marketing ROI',
        status: 'approved',
        action: 'create',
        workMonth: '2026-11',
        dueDate: '2026-11-12',
        draftUrl: 'https://docs.example/draft',
        liveUrl: 'https://example.com/roi',
        ...overrides,
    };
}

function controlDisabled(html: string, marker: string): boolean {
    const at = html.indexOf(marker);
    assert.ok(at >= 0, marker);
    const start = html.lastIndexOf('<', at);
    const tag = html.slice(start, html.indexOf('>', start)).replace(/\sclass="[^"]*"/g, '');
    return /\sdisabled(?:=|\s|$)/.test(tag);
}

function board(records: ContentBoardRecord[], contentPieces: number | null, readOnly = false) {
    return renderToStaticMarkup(createElement(ContentBoardView, {
        clientId: 'summit',
        records,
        contentPieces,
        readOnly,
        today: '2026-11',
        onStatus: () => undefined,
        onMonth: () => undefined,
    }));
}

const silo: TopicalMapSilo = {
    id: 's-1', mapId: 'm-1', organizationId: 'o-1', name: 'Local SEO',
    searchIntent: 'commercial', sortOrder: 0,
};

function record(overrides: Partial<TopicalMapRecord> = {}): TopicalMapRecord {
    return {
        id: 'r-1', siloId: 's-1', mapId: 'm-1', organizationId: 'o-1',
        pageType: 'blog_post', action: 'create', title: 'Marketing ROI formula',
        targetQuery: '', wordCountMin: 0, wordCountMax: 0, buildPhase: 1,
        scopeExclusions: [], outgoingLinks: [], status: 'pending', sortOrder: 0,
        createdAt: '', updatedAt: '',
        ...overrides,
    };
}

test('the board groups approved pages and shows the monthly plan', () => {
    const html = board([
        page({ id: 'nov', title: 'November page', workMonth: '2026-11', productionStatus: 'client_review' }),
        page({ id: 'oct', title: 'October page', workMonth: '2026-10', dueDate: '2026-10-02', draftUrl: null, liveUrl: null }),
        page({ id: 'loose', title: 'Unscheduled page', workMonth: null, dueDate: null }),
        page({ id: 'idea', title: 'Not approved', status: 'pending', workMonth: '2026-11' }),
    ], 4);

    assert.match(html, /Open client review/);
    assert.match(html, /href="\/workspace\/summit\?tab=approvals"/);
    assert.equal(html.includes('tab=content'), false);
    const unscheduled = html.indexOf('data-content-group="unscheduled"');
    const october = html.indexOf('data-content-group="2026-10"');
    const november = html.indexOf('data-content-group="2026-11"');
    assert.ok(unscheduled >= 0 && unscheduled < october && october < november);
    assert.match(html, /Not scheduled yet/);
    assert.match(html, /Unscheduled page/);
    assert.equal(html.includes('Not approved'), false);
    assert.match(html, /1 of 4 pieces planned for October 2026/);
    assert.match(html, /1 of 4 pieces planned for November 2026/);
    assert.match(html, /With client for review/);
    assert.match(html, /Open client review for November page/);
    assert.match(html, /Nov 12, 2026/);
    assert.match(html, /href="https:\/\/docs\.example\/draft"/);
    assert.match(html, /href="https:\/\/example\.com\/roi"/);
    assert.equal(html.includes('data-quota-warning'), false);
    assert.match(html, /data-read-only="false"/);

    const over = board([
        page({ id: 'a', title: 'One' }),
        page({ id: 'b', title: 'Two' }),
        page({ id: 'c', title: 'Three' }),
        page({ id: 'd', title: 'Four' }),
        page({ id: 'e', title: 'Five' }),
    ], 4);
    assert.match(over, /5 of 4 pieces planned for November 2026/);
    assert.match(over, /This goes over the 4 pieces in this month&#x27;s plan\./);

    const missing = board([page()], null);
    assert.match(missing, />\u2014</);
    assert.equal(missing.includes('pieces planned'), false);
    assert.equal(missing.includes('data-quota-warning'), false);

    const locked = board([page({ productionStatus: 'writing' })], 4, true);
    assert.match(locked, /data-read-only="true"/);
    assert.equal(controlDisabled(locked, 'id="content-status-page-1"'), true);
    assert.equal(controlDisabled(locked, 'id="content-month-page-1"'), true);
});

test('approve for a month warns when the plan is full and still allows it', () => {
    const quota = contentQuota(5, 4, '2026-11');
    const html = renderToStaticMarkup(createElement(ApproveForMonth, {
        month: '2026-11',
        months: ['2026-11', '2026-12'],
        quota,
        disabled: false,
        busy: false,
        onMonth: () => undefined,
        onApprove: () => undefined,
    }));
    assert.match(html, />Approve for November 2026</);
    assert.match(html, /5 of 4 pieces planned for November 2026/);
    assert.match(html, /This goes over the 4 pieces in this month&#x27;s plan\. You can still approve this page\./);
    assert.equal(controlDisabled(html, 'data-approve-for="2026-11"'), false);

    const viewer = renderToStaticMarkup(createElement(RecordDetailPanel, {
        record: record(),
        silos: [silo],
        isOpen: true,
        onClose: () => undefined,
        onUpdated: () => undefined,
        organizationId: 'o-1',
        clientId: 'c-1',
        contentReadOnly: true,
        contentPieces: 4,
        today: '2026-11',
        boardRecords: [
            record({ id: 'a', status: 'approved', workMonth: '2026-11' }),
            record({ id: 'b', status: 'approved', workMonth: '2026-11' }),
            record({ id: 'c', status: 'approved', workMonth: '2026-11' }),
            record({ id: 'd', status: 'approved', workMonth: '2026-11' }),
        ],
    }));
    assert.equal(controlDisabled(viewer, 'id="approve-for-month"'), true);
    assert.equal(controlDisabled(viewer, 'data-approve-for="2026-11"'), true);
    assert.equal(controlDisabled(viewer, 'id="record-production-status"'), true);
    assert.equal(controlDisabled(viewer, 'id="record-work-month"'), true);

    const member = renderToStaticMarkup(createElement(RecordDetailPanel, {
        record: record(),
        silos: [silo],
        isOpen: true,
        onClose: () => undefined,
        onUpdated: () => undefined,
        organizationId: 'o-1',
        clientId: 'c-1',
        contentPieces: 4,
        today: '2026-11',
        boardRecords: [
            record({ id: 'a', status: 'approved', workMonth: '2026-11' }),
            record({ id: 'b', status: 'approved', workMonth: '2026-11' }),
            record({ id: 'c', status: 'approved', workMonth: '2026-11' }),
            record({ id: 'd', status: 'approved', workMonth: '2026-11' }),
        ],
    }));
    assert.match(member, /Approve for November 2026/);
    assert.match(member, /5 of 4 pieces planned for November 2026/);
    assert.match(member, /This goes over the 4 pieces in this month&#x27;s plan\./);
    assert.equal(controlDisabled(member, 'data-approve-for="2026-11"'), false);

    const pageSource = readFileSync(new URL('../../app/(dashboard)/workspace/[id]/page.tsx', import.meta.url), 'utf8');
    const routeSource = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
    assert.match(pageSource, /canEditContent\(role\)/);
    assert.match(pageSource, /'content'/);
    assert.match(routeSource, /canEditContent\(auth\.role\)/);
    assert.match(routeSource, /CONTENT_READ_ONLY/);
    assert.equal(routeSource.includes('contentPieces'), false);
});

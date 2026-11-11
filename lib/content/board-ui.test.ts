import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ApproveForMonth } from '../../components/content/ApproveForMonth.tsx';
import { ContentBoardView, type ContentBoardViewProps } from '../../components/content/ContentBoard.tsx';
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
        topicGroup: 'Patient education',
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

function count(html: string, needle: string): number {
    return html.split(needle).length - 1;
}

function board(records: ContentBoardRecord[], contentPieces: number | null, extra: Partial<ContentBoardViewProps> = {}) {
    return renderToStaticMarkup(createElement(ContentBoardView, {
        clientId: 'summit',
        clientName: 'Summit Dental',
        records,
        contentPieces,
        readOnly: false,
        today: '2026-11',
        onStatus: () => undefined,
        onMonth: () => undefined,
        onApprove: () => undefined,
        onMoveOverage: () => undefined,
        onEditPlan: () => undefined,
        ...extra,
    }));
}

/** Pages shaped like the approved mockup, with neutral titles (no example client ships). */
function plannedPages(): ContentBoardRecord[] {
    return [
        page({ id: 'n1', title: 'Page one', productionStatus: 'published', dueDate: '2026-11-04', liveUrl: 'https://example.com/one', topicGroup: 'Group A' }),
        page({ id: 'n2', title: 'Page two', productionStatus: 'client_review', dueDate: '2026-11-12', draftUrl: 'https://docs.test/two' }),
        page({ id: 'n3', title: 'Page three', productionStatus: 'client_review', dueDate: '2026-11-14' }),
        page({ id: 'n4', title: 'Page four', productionStatus: 'ready', dueDate: '2026-11-18', draftUrl: 'https://docs.test/four' }),
        page({ id: 'n5', title: 'Page five', productionStatus: 'writing', dueDate: '2026-11-24', draftUrl: 'https://docs.test/five' }),
        page({ id: 'n6', title: 'Page six', productionStatus: 'approved', dueDate: '2026-11-28' }),
        page({ id: 'n7', title: 'Page seven', status: 'pending', productionStatus: 'awaiting_approval', dueDate: '2026-11-30' }),
        page({ id: 'd1', title: 'December one', workMonth: '2026-12', dueDate: '2026-12-08' }),
        page({ id: 'd2', title: 'December two', workMonth: '2026-12', dueDate: '2026-12-15' }),
        page({ id: 'u1', title: 'Idea one', status: 'pending', workMonth: null, dueDate: null, topicGroup: 'Group B' }),
        page({ id: 'u2', title: 'Idea declined', status: 'declined', productionStatus: 'declined', workMonth: null, dueDate: null }),
        page({ id: 'u3', title: 'Existing page', status: 'pending', action: 'keep', matchedUrl: 'https://example.com/home', workMonth: null, dueDate: null }),
    ];
}

test('the board shows one table per month, Unscheduled last, and the monthly plan card', () => {
    const html = board(plannedPages(), 8);

    const november = html.indexOf('data-content-group="2026-11"');
    const december = html.indexOf('data-content-group="2026-12"');
    const unscheduled = html.indexOf('data-content-group="unscheduled"');
    assert.ok(november >= 0 && november < december && december < unscheduled);
    assert.equal(count(html, '<table'), 3);
    assert.match(html, />Unscheduled</);
    assert.equal(html.includes('Not scheduled yet'), false);
    assert.match(html, /7 pages · 6 approved/);
    assert.match(html, /2 pages · 2 approved/);
    assert.match(html, /data-group-count="[^"]*">3 pages</);

    assert.match(html, /November 2026 · monthly plan/);
    assert.match(html, /6 of 8 content pieces approved for November/);
    assert.equal(count(html, 'data-segment="filled"'), 6);
    assert.equal(count(html, 'data-segment="empty"'), 2);
    assert.equal(count(html, 'data-segment="over"'), 0);
    assert.match(html, /December: <b[^>]*>2 of 8<\/b> approved/);
    assert.match(html, /Monthly plan: <b[^>]*>8 pieces<\/b> \(set in the client&#x27;s agreement\)/);
    assert.match(html, /<b[^>]*>2 more<\/b> fit in this month&#x27;s plan\./);
    assert.match(html, /Approved counts every page that&#x27;s approved, being written, in client review, ready or published\./);
    assert.match(html, /Due date is when the page should be ready\./);
    assert.match(html, /Approve a page to add it to a month\./);
    assert.equal(html.includes('data-over-plan'), false);

    assert.match(html, />Monthly plan settings</);
    assert.match(html, />Add a page</);
    assert.match(html, /Every page planned in Summit Dental&#x27;s topic map, by month\. Approve a page to schedule it\./);

    // No mockup badge and no example client data ship.
    assert.equal(/Mockup|fictional/i.test(html), false);
    const source = readFileSync(new URL('../../components/content/ContentBoard.tsx', import.meta.url), 'utf8');
    assert.equal(/Mockup ·|fictional|Summit Dental/i.test(source), false);
});

test('rows show an icon pill, the right link, and plain actions', () => {
    const html = board(plannedPages(), 8);

    const pills = html.match(/<span data-production-status="[a-z_]+"[^>]*>.*?<\/span>/g) ?? [];
    assert.equal(pills.length, plannedPages().length);
    for (const pill of pills) assert.match(pill, /<svg[^>]*aria-hidden="true"/, pill);
    assert.match(html, /<\/svg>Client review<\/span>/);
    assert.match(html, /<\/svg>Awaiting approval<\/span>/);
    assert.match(html, /<\/svg>Not written<\/span>/);
    assert.match(html, /<\/svg>Already live<\/span>/);
    assert.match(html, /<\/svg>Declined<\/span>/);

    assert.equal(count(html, '>Review in Approvals<'), 2);
    assert.match(html, /href="\/workspace\/summit\?tab=approvals"/);
    assert.equal(html.includes('href="https://docs.test/two"'), false, 'client review links to Approvals, not the draft');
    assert.match(html, /href="https:\/\/example\.com\/one"[^>]*>View live page/);
    assert.match(html, /href="https:\/\/docs\.test\/four"[^>]*>Open draft/);
    assert.match(html, /href="https:\/\/example\.com\/home"[^>]*>View live page/);
    assert.match(html, />No link yet</);
    assert.match(html, />Waiting on client</);
    assert.match(html, /text-\[#be185d\]/);
    assert.match(html, />Nov 4</);

    assert.match(html, />Approve for November</);
    assert.equal(controlDisabled(html, 'data-approve-for="2026-11"'), false);
    assert.match(html, /aria-label="Approve for a different month"/);
    assert.match(html, /aria-label="Restore Idea declined"/);
    assert.match(html, /aria-label="More actions for Page six"/);
    assert.match(html, /scope="col"[^>]*>Action</);

    assert.match(html, /aria-pressed="true"[^>]*>All</);
    for (const label of ['Needs a decision', 'In progress', 'Done']) {
        assert.match(html, new RegExp(`aria-pressed="false"[^>]*>${label}<`));
    }
    assert.match(
        html,
        /<option value=""[^>]*>All topic groups<\/option><option value="Group A">Group A<\/option><option value="Group B">Group B<\/option><option value="Patient education">Patient education<\/option><\/select>/,
    );
    assert.match(html, /placeholder="Search pages"/);
});

test('over plan shows the amber banner, a hatched overage, and approve stays enabled', () => {
    const records = [
        ...plannedPages(),
        page({ id: 'x1', title: 'Approved later', workMonth: '2026-11', dueDate: '2026-11-30', updatedAt: '2026-11-10T00:00:00Z' }),
        page({ id: 'x2', title: 'Approved last', workMonth: '2026-11', dueDate: '2026-11-30', updatedAt: '2026-11-11T00:00:00Z' }),
        page({ id: 'x3', title: 'Approved third', workMonth: '2026-11', dueDate: '2026-11-30', updatedAt: '2026-11-09T00:00:00Z' }),
    ];
    const html = board(records, 8, { freshIds: ['x2'] });
    assert.match(html, /role="status" data-over-plan="1"/);
    assert.match(html, /9 of 8 approved: 1 over this month&#x27;s plan/);
    assert.match(html, /Approving still works\. Check with the client whether the extra piece is added to this month or moved to December\./);
    assert.match(html, /data-move-overage="x2">Move 1 to December</);
    assert.match(html, />Change monthly plan</);
    assert.match(html, /9 of 8 content pieces approved for November/);
    assert.equal(count(html, 'data-segment="filled"'), 8);
    assert.equal(count(html, 'data-segment="over"'), 1);
    assert.match(html, /<b[^>]*>1 over plan\.<\/b> Approving is never blocked\./);
    assert.match(html, /Approving more adds to this month’s overage\. Nothing is blocked\./);
    assert.match(html, />Approved just now</);
    assert.equal(controlDisabled(html, 'data-approve-for="2026-11"'), false);

    const viewer = board(records, 8, { readOnly: true });
    assert.match(viewer, /9 of 8 approved: 1 over this month&#x27;s plan/);
    assert.equal(viewer.includes('data-move-overage'), false);
    assert.equal(viewer.includes('Change monthly plan'), false);
});

test('no monthly plan shows the set-plan card and still lists pages', () => {
    const html = board(plannedPages(), null);
    assert.match(html, /data-empty="no-plan"/);
    assert.match(html, /Set how many pieces are in this client&#x27;s monthly plan/);
    assert.match(html, /Once it&#x27;s set, this board shows how many pages are approved each month compared with what the client pays for\. You can approve pages either way\./);
    assert.match(html, />Set monthly plan</);
    assert.equal(html.includes('data-quota-card'), false);
    assert.equal(html.includes('data-over-plan'), false);
    assert.match(html, /No monthly plan set, so there is no limit to compare with\./);
    assert.match(html, /7 pages · 6 approved/);

    const noEditor = board(plannedPages(), null, { onEditPlan: undefined });
    assert.equal(noEditor.includes('Set monthly plan<'), false);
    assert.equal(noEditor.includes('Monthly plan settings'), false);
});

test('no topic map shows the build card under the plan card', () => {
    const html = board([], 8, { hasMap: false });
    assert.match(html, /data-empty="no-map"/);
    assert.match(html, /Build a topic map to fill this board/);
    assert.match(html, /This board lists every page planned in Summit Dental&#x27;s topic map, grouped by month\. There’s no topic map yet, so nothing is planned\./);
    assert.match(html, />Build topic map</);
    assert.match(html, />Add a page by hand</);
    assert.match(html, /href="\/workspace\/summit\?tab=topical-map"/);
    assert.match(html, /0 of 8 content pieces approved for November/);
    assert.match(html, /<b[^>]*>8 pieces<\/b> fit in this month&#x27;s plan\./);
    assert.equal(count(html, 'data-segment="empty"'), 8);
    assert.equal(html.includes('Search pages'), false);
    assert.equal(html.includes('<table'), false);

    const emptyMap = board([], 8, { hasMap: true });
    assert.match(emptyMap, /data-empty="no-pages"/);
    assert.match(emptyMap, /The topic map has no pages yet, so nothing is planned\./);
});

test('viewers see the board without any way to change it', () => {
    const html = board(plannedPages(), 8, { readOnly: true });
    assert.match(html, /data-read-only="true"/);
    assert.equal(html.includes('data-approve-for'), false);
    assert.equal(html.includes('Restore'), false);
    assert.equal(html.includes('More actions'), false);
    assert.equal(/scope="col"[^>]*>Action</.test(html), false);
    assert.equal(html.includes('Monthly plan settings'), false);
    assert.equal(html.includes('>Add a page<'), false);
    assert.match(html, />Review in Approvals</);
});

test('chips, topic group and search filter the tables on the client', () => {
    const decision = board(plannedPages(), 8, { initialView: { filter: 'decision' } });
    assert.match(decision, /aria-pressed="true"[^>]*>Needs a decision</);
    assert.match(decision, />Page seven</);
    assert.match(decision, />Idea one</);
    assert.equal(decision.includes('>Page one<'), false);
    assert.equal(decision.includes('data-content-group="2026-12"'), false);
    // Counts in the header still describe the whole month.
    assert.match(decision, /7 pages · 6 approved/);

    const done = board(plannedPages(), 8, { initialView: { filter: 'done' } });
    assert.match(done, />Page one</);
    assert.match(done, />Existing page</);
    assert.equal(done.includes('>Page six<'), false);

    const topic = board(plannedPages(), 8, { initialView: { topicGroup: 'Group B' } });
    assert.match(topic, />Idea one</);
    assert.equal(topic.includes('>Page two<'), false);

    const search = board(plannedPages(), 8, { initialView: { query: 'december' } });
    assert.match(search, />December one</);
    assert.match(search, />December two</);
    assert.equal(search.includes('>Page one<'), false);

    const none = board(plannedPages(), 8, { initialView: { query: 'zzz' } });
    assert.match(none, /No pages match these filters\./);
    assert.match(none, />Show all pages</);
});

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
    assert.match(pageSource, /onEditPlan=\{\(\) => setShowEditPanel\(true\)\}/);
    assert.match(routeSource, /canEditContent\(auth\.role\)/);
    assert.match(routeSource, /CONTENT_READ_ONLY/);
    assert.equal(routeSource.includes('contentPieces'), false);
});

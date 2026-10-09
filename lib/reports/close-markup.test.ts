import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildCloseBoard } from './close-board';
import { CloseBoard } from '../../components/reports/close/CloseBoard.tsx';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function board() {
    const now = new Date('2026-10-09T18:00:00.000Z');
    return buildCloseBoard({
        month: '2026-09',
        now,
        role: 'member',
        clients: [
            {
                id: 'c1',
                name: 'Scott Cole Plumbing',
                domain: 'scott.example',
                accountManagerId: 'am',
                accountManagerName: 'Abel',
                seoHours: 10,
            },
            {
                id: 'c2',
                name: 'No Console Co',
                domain: null,
                accountManagerId: 'am',
                accountManagerName: 'Abel',
                seoHours: 3,
            },
            {
                id: 'c3',
                name: 'Scott Draft Pending',
                domain: 'pending.example',
                accountManagerId: 'am',
                accountManagerName: 'Abel',
                seoHours: 8,
            },
        ],
        reports: [{
            id: 'r1',
            clientId: 'c1',
            kind: 'monthly',
            title: 'September',
            status: 'draft',
            executiveSummary: '',
            recommendations: '',
            sections: null,
            updatedAt: '2026-10-01T00:00:00.000Z',
        }],
        reviews: [],
        integrations: [{
            clientId: 'c1',
            service: 'gsc',
            syncStatus: 'active',
            lastSyncedAt: now.toISOString(),
            siteUrl: 'sc-domain:hidden.example',
        }, {
            clientId: 'c3',
            service: 'gsc',
            syncStatus: 'active',
            lastSyncedAt: now.toISOString(),
            siteUrl: 'sc-domain:pending.example',
        }, {
            clientId: 'c1',
            service: 'ahrefs',
            syncStatus: 'error',
            lastSyncedAt: null,
            siteUrl: null,
        }],
        hours: [{ clientId: 'c2', hours: 2 }],
        completedTaskClientIds: [],
        deliverables: [],
        metrics: [],
        gscDays: Array.from({ length: 30 }, (_, index) => ({
            id: `d${index + 1}`,
            clientId: 'c1',
            property: 'sc-domain:hidden.example',
            date: `2026-09-${String(index + 1).padStart(2, '0')}`,
            isIncomplete: false,
        })),
        gscFacts: Array.from({ length: 30 }, (_, index) => ({ dayId: `d${index + 1}`, clicks: 2, impressions: 5 })),
        recipientClientIds: [],
    });
}

test('the board markup follows the close naming and stays inside the column scroller', () => {
    const html = renderToStaticMarkup(createElement(CloseBoard, {
        board: board(),
        busy: false,
        error: '',
        onApprove() {},
        onSchedule() {},
    }));
    assert.match(html, /Reports · September close/);
    assert.match(html, /Blocked/);
    assert.match(html, /Ready/);
    assert.match(html, /Approved &amp; scheduled/);
    assert.match(html, /Sent/);
    assert.match(html, /No client has a portal contact on file/);
    assert.match(html, /Add contacts/);
    assert.match(html, /No Search Console/);
    assert.match(html, /Connect/);
    assert.match(html, /Not drafted yet/);
    assert.match(html, /Scott Draft Pending/);
    assert.match(html, /September draft not created yet/);
    assert.equal(html.includes('No clients in this group'), false);
    assert.match(html, /Tracker error/);
    assert.match(html, /Preview report/);
    assert.match(html, /range=2026-09/);
    assert.match(html, /Approve/);
    assert.match(html, /Schedule/);
    assert.match(html, /data-close-columns/);
    assert.match(html, /overflow-x-auto/);
    assert.match(html, /overflow-y-auto/);
    assert.match(html, /role="listbox"/);
    assert.equal(html.includes('Needs attention'), false);
    assert.equal(html.includes('sc-domain:hidden.example'), false);
    assert.equal(html.includes('data-kpi'), false);
});

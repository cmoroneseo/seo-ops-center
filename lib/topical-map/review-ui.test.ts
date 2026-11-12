import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ReviewTopicIdeasView, type ReviewTopicIdeasViewProps } from '../../components/topical-map/ReviewTopicIdeas.tsx';
import { ReviewIdeasPrompt } from '../../components/topical-map/ReviewIdeasPrompt.tsx';
import type { ReviewEvidence } from './review.ts';
import type { TopicalMapRecord, TopicalMapSilo } from '../types.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const silos: TopicalMapSilo[] = [
    { id: 'silo-a', mapId: 'map', organizationId: 'org', name: 'Topic group A', searchIntent: 'informational', sortOrder: 0 },
    { id: 'silo-b', mapId: 'map', organizationId: 'org', name: 'Topic group B', searchIntent: 'informational', sortOrder: 1 },
];

function idea(id: string, overrides: Partial<TopicalMapRecord> = {}): TopicalMapRecord {
    return {
        id,
        siloId: 'silo-a',
        mapId: 'map',
        organizationId: 'org',
        pageType: 'blog_post',
        action: 'create',
        title: `Idea ${id}`,
        targetQuery: `search ${id}`,
        wordCountMin: 0,
        wordCountMax: 0,
        buildPhase: 2,
        scopeExclusions: [],
        outgoingLinks: [],
        status: 'pending',
        sortOrder: 0,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        ...overrides,
    };
}

/** Neutral ideas. No example client or mockup data ships. */
function ideas(): TopicalMapRecord[] {
    return [
        idea('main', { sortOrder: 0, buildPhase: 1 }),
        idea('quick', { parentRecordId: 'main', sortOrder: 1 }),
        idea('dup', { parentRecordId: 'main', sortOrder: 2 }),
        idea('live', { siloId: 'silo-b', action: 'keep', matchedUrl: 'https://example.com/live-page', sortOrder: 0 }),
        idea('other', { siloId: 'silo-b', parentRecordId: 'live', sortOrder: 1 }),
    ];
}

const evidence: ReviewEvidence = {
    connected: true,
    days: 28,
    queries: [
        { query: 'search quick', impressions: 420, clicks: 3, position: 14, pages: [], competing: false },
        { query: 'search dup', impressions: 900, clicks: 40, position: 4, pages: [{ url: 'https://example.com/x', impressions: 900, position: 4 }], competing: false },
    ],
};

function render(extra: Partial<ReviewTopicIdeasViewProps> = {}) {
    return renderToStaticMarkup(createElement(ReviewTopicIdeasView, {
        clientId: 'client-1',
        clientName: 'Client One',
        silos,
        records: ideas(),
        evidence,
        contentPieces: 8,
        readOnly: false,
        today: '2026-11',
        onApprove: () => true,
        onDecline: () => true,
        onReopen: () => undefined,
        onRename: () => true,
        onBack: () => undefined,
        ...extra,
    }));
}

function rowOrder(html: string): string[] {
    return [...html.matchAll(/data-review-row="([^"]+)"/g)].map(match => match[1]);
}

test('ideas are grouped by topic group and sorted by priority by default', () => {
    const html = render();
    assert.ok(html.includes('Review topic ideas'));
    assert.ok(html.includes('Review and build'));
    assert.ok(html.includes('>Topic group A<'));
    // Scored ideas first. Ideas without data keep topic map order.
    assert.deepEqual(rowOrder(html), ['quick', 'dup', 'main', 'live', 'other']);
    assert.ok(html.includes('Already shows up in 420 Google searches a month, sitting on page 2: a quick win'));
    assert.ok(html.includes('New topic, no Google data yet'));
    assert.ok(html.includes('No Google data yet'));
    assert.ok(html.includes('Spot 14 in Google'));
});

test('map order keeps main topic pages above their supporting articles', () => {
    assert.deepEqual(rowOrder(render({ initialSort: 'map' })), ['main', 'quick', 'dup', 'live', 'other']);
});

test('a new page for a search an existing page covers is flagged before approving', () => {
    const html = render();
    assert.ok(html.includes('Your page /x already covers this. Approving may create two pages competing for the same search.'));
    const confirm = render({ initialConfirm: 'dup' });
    assert.ok(confirm.includes('data-duplicate-confirm="dup"'));
    assert.ok(confirm.includes('Before you approve:'));
    assert.ok(confirm.includes('Approve anyway for November'));
});

test('selecting ideas shows the action bar and bulk buttons; warned picks ask first', () => {
    const html = render({ initialSelected: ['quick', 'dup'] });
    assert.ok(html.includes('2 selected'));
    assert.ok(html.includes('November would be 2 of 8'));
    assert.ok(html.includes('data-bulk-approve="2"'));
    assert.ok(html.includes('data-bulk-decline="2"'));
    assert.ok(html.includes('Approve for November'));
    assert.ok(html.includes('Clear selection'));
    assert.ok(html.includes('aria-label="Select all waiting ideas"'));
    assert.ok(html.includes('aria-label="Select all in Topic group A"'));
    const confirm = render({ initialSelected: ['quick', 'dup'], initialConfirm: 'bulk' });
    assert.ok(confirm.includes('1 selected idea may compete with a page you already have.'));
    assert.ok(confirm.includes('Approve anyway'));
});

test('going over the monthly plan warns and never disables approve', () => {
    const planned = Array.from({ length: 7 }, (_, index) => idea(`p${index}`, {
        siloId: 'silo-b', status: 'approved', productionStatus: 'approved', workMonth: '2026-11', sortOrder: 10 + index,
    }));
    const html = render({ records: [...ideas(), ...planned], initialSelected: ['quick', 'dup', 'main'], initialMonthMenuOpen: true });
    assert.ok(html.includes("Approving the 3 selected would make November 10 of 8: 2 over this month&#x27;s plan"));
    assert.ok(html.includes('You can still approve.'));
    assert.ok(html.includes('November would be 2 over plan'));
    assert.ok(html.includes('Would be 2 over plan'));
    assert.ok(html.includes('Would be 3 of 8: fits'));
    const bar = html.slice(html.indexOf('data-bulk-approve'));
    assert.ok(!/^[^>]*\sdisabled/.test(bar));
});

test('viewers see the ideas read-only: no checkboxes, no approve, decline or title edits', () => {
    const html = render({ readOnly: true, initialSelected: ['quick'], initialEditingId: 'quick', initialConfirm: 'dup' });
    assert.ok(html.includes('data-read-only="true"'));
    assert.ok(html.includes('You can view these ideas, not change them.'));
    assert.ok(!html.includes('role="checkbox"'));
    assert.ok(!html.includes('data-approve='));
    assert.ok(!html.includes('data-decline='));
    assert.ok(!html.includes('Edit title'));
    assert.ok(!html.includes('aria-label="Page title"'));
    assert.ok(!html.includes('data-bulk-approve'));
    assert.ok(!html.includes('data-duplicate-confirm'));
    assert.ok(html.includes('Already shows up in 420 Google searches a month'));
});

test('approved, declined and live ideas offer Undo, Restore and View page', () => {
    const records = [
        idea('a', { status: 'approved', productionStatus: 'approved', workMonth: '2026-12' }),
        idea('d', { status: 'declined', productionStatus: 'declined', sortOrder: 1 }),
        idea('w', { sortOrder: 2 }),
        idea('live', { action: 'keep', matchedUrl: 'https://example.com/live-page', sortOrder: 3 }),
    ];
    const html = render({ records });
    assert.ok(html.includes('Will be added to the Content board for December'));
    assert.ok(html.includes('>Undo<'));
    assert.ok(html.includes('>Restore<'));
    assert.ok(html.includes('href="https://example.com/live-page"'));
    assert.ok(html.includes('Already on your site, so it can&#x27;t be added as new content.'));
    assert.ok(html.includes('text-[#be185d]'));
    assert.ok(html.includes('dark:text-pink-300'));
});

test('the pencil opens a title editor with Save and Cancel', () => {
    const html = render({ initialEditingId: 'quick' });
    assert.ok(html.includes('aria-label="Page title"'));
    assert.ok(html.includes('value="Idea quick"'));
    assert.ok(html.includes('>Save<'));
    assert.ok(html.includes('>Cancel<'));
});

test('when nothing is left to review the done card sums it up', () => {
    const records = [
        idea('a', { status: 'approved', productionStatus: 'approved', workMonth: '2026-11' }),
        idea('b', { status: 'approved', productionStatus: 'approved', workMonth: '2026-12', sortOrder: 1 }),
        idea('d', { status: 'declined', productionStatus: 'declined', sortOrder: 2 }),
        idea('live', { action: 'keep', matchedUrl: 'https://example.com/live-page', sortOrder: 3 }),
    ];
    const html = render({ records });
    assert.ok(html.includes('All 4 topic ideas reviewed'));
    assert.ok(html.includes('Approved ideas were added to the Content board: 1 for November and 1 for December.'));
    assert.ok(html.includes('href="/workspace/client-1?tab=content"'));
    assert.ok(html.includes('Go to Content board'));
    assert.ok(html.includes('Back to topic map'));
    assert.ok(!html.includes('data-review-row'));
});

test('without Search Console every idea says it has no Google data, never a number', () => {
    const html = render({ evidence: { connected: false, days: 0, queries: [] } });
    assert.ok(html.includes('Google Search Console is not connected'));
    assert.equal(html.split('New topic, no Google data yet').length - 1, 5);
    assert.ok(!html.includes('/100'));
});

test('no mockup badges, sample data or keyword-provider labels ship', () => {
    const html = render({ initialSelected: ['quick'] });
    for (const banned of ['Ahrefs', 'Semrush', 'DataForSEO', 'Estimate', 'Mockup', 'Sample data', 'fictional', 'Summit Dental']) {
        assert.ok(!html.includes(banned), banned);
    }
});

test('the topic map prompts a review while ideas are waiting', () => {
    const html = renderToStaticMarkup(createElement(ReviewIdeasPrompt, { waiting: 3, total: 5, onReview: () => undefined }));
    assert.ok(html.includes('3 of 5 topic ideas are waiting for review.'));
    assert.ok(html.includes('Review topic ideas'));
    assert.equal(renderToStaticMarkup(createElement(ReviewIdeasPrompt, { waiting: 0, total: 5, onReview: () => undefined })), '');
});

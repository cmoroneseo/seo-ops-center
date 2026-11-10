import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RecordDetailPanel } from '../../components/topical-map/RecordDetailPanel.tsx';
import { RecordRow } from '../../components/topical-map/RecordRow.tsx';
import type { TopicalMapRecord, TopicalMapSilo } from '../types.ts';
import { PRODUCTION_STATUS_LABEL, PRODUCTION_STATUSES, PUBLISHED_NOTE } from './production.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const silo: TopicalMapSilo = {
    id: 's-1', mapId: 'm-1', organizationId: 'o-1', name: 'Local SEO',
    searchIntent: 'commercial', sortOrder: 0,
};

function record(overrides: Partial<TopicalMapRecord> = {}): TopicalMapRecord {
    return {
        id: 'r-1', siloId: 's-1', mapId: 'm-1', organizationId: 'o-1',
        pageType: 'blog_post', action: 'create', title: 'Marketing ROI formula',
        targetQuery: 'marketing roi formula', wordCountMin: 0, wordCountMax: 0, buildPhase: 1,
        scopeExclusions: [], outgoingLinks: [], status: 'pending', sortOrder: 0,
        createdAt: '', updatedAt: '',
        ...overrides,
    };
}

function visible(html: string): string {
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

function panel(overrides: Partial<TopicalMapRecord> = {}) {
    return renderToStaticMarkup(createElement(RecordDetailPanel, {
        record: record(overrides),
        silos: [silo],
        isOpen: true,
        onClose: () => undefined,
        onUpdated: () => undefined,
        organizationId: 'o-1',
        clientId: 'c-1',
    }));
}

test('a record row shows the plain status and not the stored slug', () => {
    const pending = renderToStaticMarkup(createElement(RecordRow, {
        record: record(),
        onClick: () => undefined,
    }));
    assert.match(pending, /Not written yet/);
    assert.match(pending, /data-production-status="not_written"/);
    assert.equal(visible(pending).includes('not_written'), false);
    assert.equal(visible(pending).includes('pending'), false);

    const live = renderToStaticMarkup(createElement(RecordRow, {
        record: record({ action: 'keep', matchedUrl: 'https://example.com/roi' }),
        onClick: () => undefined,
    }));
    assert.match(visible(live), /Already on the site/);
    assert.equal(visible(live).includes('already_live'), false);

    const writing = renderToStaticMarkup(createElement(RecordRow, {
        record: record({
            action: 'keep',
            matchedUrl: 'https://example.com/roi',
            productionStatus: 'writing',
        }),
        onClick: () => undefined,
    }));
    assert.match(visible(writing), /Being written/);
    assert.equal(visible(writing).includes('Already on the site'), false);

    const published = renderToStaticMarkup(createElement(RecordRow, {
        record: record({ productionStatus: 'published' }),
        onClick: () => undefined,
    }));
    assert.match(published, /Published/);
    assert.match(published, new RegExp(`title="${PUBLISHED_NOTE}"`));
});

test('the record drawer edits status, month, dates, and links in plain English', () => {
    const html = panel();
    const text = visible(html);
    assert.match(html, /id="record-production-status"/);
    assert.match(html, /id="record-work-month"/);
    assert.match(html, /id="record-due-date"/);
    assert.match(html, /id="record-published-on"/);
    assert.match(html, /id="record-draft-url"/);
    assert.match(html, /id="record-live-url"/);
    assert.match(html, /id="record-content-type"/);
    assert.match(text, /Not written yet/);
    assert.match(text, /Not chosen yet/);
    assert.match(text, /Type of page/);
    assert.match(text, /Due date/);
    assert.match(text, /Draft link/);
    assert.match(text, /Live link/);
    assert.equal(text.includes('Already on the site'), false);
    for (const status of PRODUCTION_STATUSES) {
        if (status === 'already_live') continue;
        assert.match(html, new RegExp(`<option value="${status}"[^>]*>${PRODUCTION_STATUS_LABEL[status]}</option>`));
        if (status.includes('_')) assert.equal(text.includes(status), false, status);
    }
    assert.equal(html.includes('<option value="already_live">'), false);
    assert.equal(text.includes('not_written'), false);
    assert.equal(text.includes('blog_post'), false);

    const kept = panel({ action: 'keep', matchedUrl: 'https://example.com/roi', draftUrl: 'https://docs.example/draft' });
    assert.match(kept, /<option value="already_live"[^>]*>Already on the site<\/option>/);
    assert.match(visible(kept), /Already on the site/);
    assert.match(kept, /Open draft/);
    assert.match(kept, /href="https:\/\/docs\.example\/draft"/);
    assert.equal(visible(kept).includes('already_live'), false);
});

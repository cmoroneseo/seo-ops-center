import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RecordDetailPanel } from '../../components/topical-map/RecordDetailPanel.tsx';
import { RecordRow } from '../../components/topical-map/RecordRow.tsx';
import { SiloAccordion } from '../../components/topical-map/SiloAccordion.tsx';
import { AddRecordDialog } from '../../components/topical-map/AddRecordDialog.tsx';
import type { TopicalMapRecord, TopicalMapSilo } from '../types.ts';

// These components rely on Next's automatic JSX runtime in the app.
// The direct tsx test runner preserves JSX, so expose React for server rendering.
(globalThis as typeof globalThis & { React: typeof React }).React = React;

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

function buttonDisabled(html: string, label: string): boolean {
    const end = html.indexOf(`>${label}<`);
    assert.ok(end >= 0, label);
    const start = html.lastIndexOf('<button', end);
    const opening = html.slice(start, html.indexOf('>', start)).replace(/\sclass="[^"]*"/g, '');
    return /\sdisabled(?:=|\s|$)/.test(opening);
}

function panel(specEnabled: boolean, overrides: Partial<TopicalMapRecord> = {}) {
    return renderToStaticMarkup(createElement(RecordDetailPanel, {
        record: record(overrides),
        silos: [silo],
        isOpen: true,
        onClose: () => undefined,
        onUpdated: () => undefined,
        organizationId: 'o-1',
        clientId: 'c-1',
        specEnabled,
    }));
}

test('the spec drawer shows the spec, an em dash for empty fields, and approve and decline', () => {
    const html = panel(true);
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    const labelledBy = html.match(/aria-labelledby="([^"]+)"/);
    assert.ok(labelledBy);
    assert.match(html, new RegExp(`id="${labelledBy[1]}"`));
    assert.match(html, /Target query/);
    assert.match(html, /Word range/);
    assert.match(html, /Answer in the first 60 words/);
    assert.match(html, /Unique angle/);
    assert.match(html, /Scheduled for/);
    assert.match(html, /Spec status/);
    assert.match(html, /Stays out of/);
    assert.match(html, /Planned links/);
    assert.match(html, /Source/);
    assert.match(html, /\u2014/);
    assert.equal(html.includes('value="0"'), false);
    assert.equal(html.includes('0 of 60'), false);
    assert.equal(buttonDisabled(html, 'Approve'), false);
    assert.equal(buttonDisabled(html, 'Decline'), false);
});

test('approve and decline stay available when the spec flag is off', () => {
    const html = panel(false);
    assert.match(html, /Target Query/);
    assert.match(html, />Approve</);
    assert.match(html, />Decline</);
    assert.equal(html.includes('Unique angle'), false);
    assert.equal(html.includes('Answer in the first 60 words'), false);
    const approved = panel(false, { status: 'approved' });
    assert.equal(buttonDisabled(approved, 'Approve'), true);
    assert.equal(buttonDisabled(approved, 'Decline'), false);
    const declined = panel(false, { status: 'declined' });
    assert.equal(buttonDisabled(declined, 'Decline'), true);
    assert.equal(buttonDisabled(declined, 'Approve'), false);
});

test('a manual record shows a manual badge and each silo can add one', () => {
    const row = renderToStaticMarkup(createElement(RecordRow, {
        record: record({ source: 'manual', targetQuery: 'marketing roi formula' }),
        onClick: () => undefined,
    }));
    assert.match(row, />manual</);
    const generated = renderToStaticMarkup(createElement(RecordRow, {
        record: record({ source: 'generated' }),
        onClick: () => undefined,
    }));
    assert.equal(generated.includes('>manual<'), false);

    const open = renderToStaticMarkup(createElement(SiloAccordion, {
        silo, records: [], specEnabled: true, clientId: 'c-1', onSelectRecord: () => undefined,
    }));
    assert.match(open, /Add record/);
    assert.match(open, /aria-label="Add record to Local SEO"/);
    const closed = renderToStaticMarkup(createElement(SiloAccordion, {
        silo, records: [], onSelectRecord: () => undefined,
    }));
    assert.equal(closed.includes('Add record'), false);

    const dialog = renderToStaticMarkup(createElement(AddRecordDialog, {
        siloName: 'Local SEO', onClose: () => undefined, onSubmit: () => undefined,
    }));
    assert.match(dialog, /role="dialog"/);
    assert.match(dialog, /aria-modal="true"/);
    assert.match(dialog, /It is marked manual/);
    assert.match(dialog, /Answer in the first 60 words/);
    assert.match(dialog, /Stays out of/);
    assert.match(dialog, /Planned links/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RecordDetailPanel } from '../../components/topical-map/RecordDetailPanel.tsx';
import { RecordRow } from '../../components/topical-map/RecordRow.tsx';
import { SiloAccordion } from '../../components/topical-map/SiloAccordion.tsx';
import { TopicalMapHeader } from '../../components/topical-map/TopicalMapHeader.tsx';
import { AI_ESTIMATE_LABEL } from './metrics.ts';
import type { TopicalMap, TopicalMapRecord, TopicalMapSilo } from '../types.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const silo: TopicalMapSilo = {
    id: 's-1', mapId: 'm-1', organizationId: 'o-1', name: 'Local SEO',
    searchIntent: 'commercial', sortOrder: 0,
};

const map: TopicalMap = {
    id: 'm-1', organizationId: 'o-1', clientId: 'c-1', version: 1, status: 'draft',
    title: 'Northside map', seedInput: { rivals: [], focusTopics: [] },
    generationMetadata: {}, createdAt: '', updatedAt: '',
};

function record(overrides: Partial<TopicalMapRecord> = {}): TopicalMapRecord {
    return {
        id: 'r-1', siloId: 's-1', mapId: 'm-1', organizationId: 'o-1',
        pageType: 'service', action: 'create', title: 'Emergency plumber',
        targetQuery: 'emergency plumber', wordCountMin: 800, wordCountMax: 1200, buildPhase: 1,
        scopeExclusions: [], outgoingLinks: [], status: 'pending', sortOrder: 0,
        createdAt: '', updatedAt: '',
        ...overrides,
    };
}

test('the map labels AI volume and keyword difficulty and does not roll them into demand', () => {
    const estimated = record({ searchVolumeMonthly: 2400, keywordDifficulty: 52 });
    const row = renderToStaticMarkup(createElement(RecordRow, { record: estimated, onClick: () => undefined }));
    assert.match(row, new RegExp(AI_ESTIMATE_LABEL));
    assert.match(row, /2,400/);
    assert.match(row, /52/);

    const plain = renderToStaticMarkup(createElement(RecordRow, { record: record(), onClick: () => undefined }));
    assert.equal(plain.includes(AI_ESTIMATE_LABEL), false);

    const header = renderToStaticMarkup(createElement(TopicalMapHeader, {
        map,
        records: [estimated, record({ id: 'r-2', searchVolumeMonthly: 1600 })],
        onEditProfile: () => undefined,
        onRegenerate: () => undefined,
    }));
    assert.match(header, /Total Demand/);
    assert.match(header, new RegExp(AI_ESTIMATE_LABEL));
    assert.equal(header.includes('4,000'), false);
    assert.equal(header.includes('2,400'), false);

    const siloHtml = renderToStaticMarkup(createElement(SiloAccordion, {
        silo,
        records: [estimated],
        onSelectRecord: () => undefined,
    }));
    assert.match(siloHtml, /0 demand/);
    assert.match(siloHtml, new RegExp(AI_ESTIMATE_LABEL));
    assert.equal(siloHtml.includes('2,400 demand'), false);

    const panel = renderToStaticMarkup(createElement(RecordDetailPanel, {
        record: estimated,
        silos: [silo],
        isOpen: true,
        onClose: () => undefined,
        onUpdated: () => undefined,
        organizationId: 'o-1',
        clientId: 'c-1',
    }));
    assert.match(panel, /id="record-metrics-estimate"/);
    assert.match(panel, new RegExp(AI_ESTIMATE_LABEL));
    assert.match(panel, /aria-describedby="record-metrics-estimate"/);

    const emptyPanel = renderToStaticMarkup(createElement(RecordDetailPanel, {
        record: record(),
        silos: [silo],
        isOpen: true,
        onClose: () => undefined,
        onUpdated: () => undefined,
        organizationId: 'o-1',
        clientId: 'c-1',
    }));
    assert.equal(emptyPanel.includes(AI_ESTIMATE_LABEL), false);
    assert.equal(emptyPanel.includes('record-metrics-estimate'), false);
});

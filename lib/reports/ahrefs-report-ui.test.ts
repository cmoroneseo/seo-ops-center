import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MetricsOverviewBlock, type ReportContext } from '../../components/reports/ReportBlocks.tsx';

function context(current: Record<string, unknown>): ReportContext {
    return {
        reportId: 'report-1',
        client: null,
        reportMonth: '2026-08',
        executiveSummary: '',
        recommendations: '',
        metrics: { current: { ahrefs: current }, previous: {} },
        history: {},
        hideEmpty: false,
    };
}

test('an Ahrefs report card renders an em dash for a null domain rating and keeps a real zero', () => {
    const missing = renderToStaticMarkup(createElement(MetricsOverviewBlock, {
        block: { id: 'block-1', type: 'metrics_overview', props: { source: 'ahrefs' } },
        ctx: context({ domain_rating: null, ranked_keywords: 4, top_10_keywords: 1, top_20_keywords: 2, top_50_keywords: 3 }),
    }));
    assert.match(missing, /Domain Rating/);
    assert.match(missing, /—/);
    assert.match(missing, />4</);

    const zero = renderToStaticMarkup(createElement(MetricsOverviewBlock, {
        block: { id: 'block-1', type: 'metrics_overview', props: { source: 'ahrefs' } },
        ctx: context({ domain_rating: 0, ranked_keywords: 0, top_10_keywords: 0, top_20_keywords: 0, top_50_keywords: 0 }),
    }));
    assert.match(zero, /Domain Rating/);
    assert.doesNotMatch(zero, /—/);
    assert.match(zero, />0</);
});

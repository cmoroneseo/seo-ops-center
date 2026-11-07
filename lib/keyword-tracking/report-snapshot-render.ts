import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { TrackedKeywordsReportBlock, TrackedKeywordsReportBody } from '../../components/reports/TrackedKeywordsReportBlock.tsx';
import type { ReportContext } from '../../components/reports/ReportBlocks.tsx';
import type { ClientProject } from '../types.ts';
import type { TrackedKeywordReportSnapshot } from './report-snapshot.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

export function renderTrackedKeywordSnapshot(snapshot: TrackedKeywordReportSnapshot | null): string {
    return renderToStaticMarkup(createElement(TrackedKeywordsReportBody, { snapshot }));
}

export function renderTrackedKeywordBlock(ctx: Partial<ReportContext> & Pick<ReportContext, 'reportStatus' | 'trackingSnapshot'>): string {
    const context = {
        reportId: '66666666-6666-4666-8666-666666666666',
        client: { id: '33333333-3333-4333-8333-333333333333', clientName: 'Fixture Client' } as ClientProject,
        reportMonth: '2026-11',
        executiveSummary: '',
        recommendations: '',
        metrics: { current: {}, previous: {} },
        history: {},
        hideEmpty: false,
        organizationId: '11111111-1111-4111-8111-111111111111',
        ...ctx,
    } as ReportContext;
    return renderToStaticMarkup(createElement(TrackedKeywordsReportBlock, {
        block: { id: 'tracked', type: 'tracked_keywords_gsc', props: {} },
        ctx: context,
    }));
}

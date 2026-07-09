// Stock report templates (SE Ranking-style "Start from template" gallery).
// Custom org templates live in the report_templates table; these ship in code.

import { Block, makeBlock } from './blocks';

export interface StockTemplate {
    key: string;
    name: string;
    description: string;
    /** Ordered section names shown on the gallery card. */
    outline: string[];
    build: () => Block[];
}

export const STOCK_TEMPLATES: StockTemplate[] = [
    {
        key: 'monthly_seo',
        name: 'Monthly SEO Report',
        description: 'The full monthly client report — summary, all four sources, recommendations.',
        outline: ['Cover', 'Executive Summary', 'Organic Search', 'Website Traffic', 'Local Presence', 'Authority & Rankings', 'Recommendations'],
        build: () => [
            makeBlock('cover', {}),
            makeBlock('text', { field: 'executive_summary', label: 'Executive Summary' }),
            makeBlock('metrics_overview', { source: 'gsc' }),
            makeBlock('metrics_overview', { source: 'ga4' }),
            makeBlock('metrics_overview', { source: 'gbp' }),
            makeBlock('metrics_overview', { source: 'ahrefs' }),
            makeBlock('text', { field: 'recommendations', label: 'Recommendations' }),
        ],
    },
    {
        key: 'rankings_overview',
        name: 'Rankings Overview',
        description: 'Ranking-focused: key metrics, position trends, top-position distribution and tracked keywords.',
        outline: ['Cover', 'Key ranking metrics', 'Average position trend', 'Keywords in top trend', 'Distribution by top positions', 'All keywords rankings', 'Recommendations'],
        build: () => [
            makeBlock('cover', {}),
            makeBlock('metrics_overview', { source: 'ahrefs' }),
            makeBlock('trend', { source: 'gsc', metrics: ['avg_position'], title: 'Average Position', invertY: true }),
            makeBlock('trend', { source: 'ahrefs', metrics: ['top_10_keywords', 'top_20_keywords', 'top_50_keywords'], title: 'Keywords in Top Positions' }),
            makeBlock('distribution', {}),
            makeBlock('keyword_rankings_table', {}),
            makeBlock('text', { field: 'recommendations', label: 'Recommendations' }),
        ],
    },
    {
        key: 'traffic_overview',
        name: 'Traffic Overview',
        description: 'Analytics-focused: traffic KPIs, trend and monthly organic history.',
        outline: ['Cover', 'Overview', 'Traffic trend', 'Organic traffic table', 'Local Presence'],
        build: () => [
            makeBlock('cover', {}),
            makeBlock('text', { field: 'executive_summary', label: 'Executive Summary' }),
            makeBlock('metrics_overview', { source: 'ga4' }),
            makeBlock('trend', { source: 'ga4', metrics: ['sessions', 'organic_sessions'], title: 'Traffic' }),
            makeBlock('organic_table', {}),
            makeBlock('metrics_overview', { source: 'gbp' }),
        ],
    },
    {
        key: 'organic_traffic',
        name: 'Organic Traffic',
        description: 'The quick one — cover plus organic performance.',
        outline: ['Cover', 'Traffic trend', 'Organic search overview'],
        build: () => [
            makeBlock('cover', {}),
            makeBlock('trend', { source: 'ga4', metrics: ['sessions', 'organic_sessions'], title: 'Traffic' }),
            makeBlock('metrics_overview', { source: 'gsc' }),
        ],
    },
    {
        key: 'blank',
        name: 'Blank',
        description: 'Start from scratch and compose your own report.',
        outline: ['Cover'],
        build: () => [makeBlock('cover', {})],
    },
];

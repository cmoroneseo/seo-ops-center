// Block-based report body (v2). A report's `sections` jsonb is either the
// legacy v1 SectionConfig[] (4 source toggles) or a v2 BlocksDoc. v1 docs are
// upgraded to blocks on read via blocksFromLegacy().

import { ReportSourceKey, SectionConfig, defaultSectionConfig } from './sections';

export type BlockType =
    // Formatting blocks
    | 'cover' | 'title' | 'text' | 'image' | 'page_break'
    | 'grid_comparison'    // before/after screenshot comparison (manual upload, no data source)
    // Data widgets
    | 'metrics_overview'   // KPI card grid for one source (props.source)
    | 'trend'              // multi-month line chart (props.source, props.metrics)
    | 'distribution'       // keywords by top-position buckets (Ahrefs)
    | 'organic_table';     // monthly organic history table (GSC + GA4)

export interface Block {
    id: string;
    type: BlockType;
    props: Record<string, any>;
}

export interface BlocksDoc {
    version: 2;
    blocks: Block[];
}

export type ReportSectionsField = SectionConfig[] | BlocksDoc | null;

export function isBlocksDoc(sections: ReportSectionsField): sections is BlocksDoc {
    return !!sections && !Array.isArray(sections) && (sections as BlocksDoc).version === 2;
}

export function newBlockId(): string {
    // crypto.randomUUID exists in all our runtimes (Node 18+, modern browsers)
    return typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeBlock(type: BlockType, props: Record<string, any> = {}): Block {
    return { id: newBlockId(), type, props };
}

/** Upgrade a legacy v1 section config to the v2 block layout it rendered as. */
export function blocksFromLegacy(sections: SectionConfig[] | null): Block[] {
    const cfg = sections?.length ? sections : defaultSectionConfig();
    const enabled = [...cfg].filter(s => s.enabled).sort((a, b) => a.order - b.order);
    return [
        makeBlock('cover', {}),
        makeBlock('text', { field: 'executive_summary', label: 'Executive Summary' }),
        ...enabled.map(s => makeBlock('metrics_overview', { source: s.key })),
        makeBlock('text', { field: 'recommendations', label: 'Recommendations' }),
    ];
}

/** Resolve whatever is stored in reports.sections into a v2 block list. */
export function resolveBlocks(sections: ReportSectionsField): Block[] {
    if (isBlocksDoc(sections)) return sections.blocks;
    return blocksFromLegacy(Array.isArray(sections) ? sections : null);
}

// ─── Widget library (left panel, grouped like SE Ranking's section list) ─────

export interface LibraryItem {
    key: string;            // unique within the library
    name: string;
    description: string;
    type: BlockType;
    props: Record<string, any>;
}

export interface LibraryGroup {
    name: string;
    source: ReportSourceKey; // used to badge availability from synced data
    items: LibraryItem[];
}

export const WIDGET_LIBRARY: LibraryGroup[] = [
    {
        name: 'Rankings',
        source: 'ahrefs',
        items: [
            {
                key: 'key_ranking_metrics', name: 'Key ranking metrics',
                description: 'DR, ranked keywords & top positions',
                type: 'metrics_overview', props: { source: 'ahrefs' },
            },
            {
                key: 'keywords_in_top_trend', name: 'Keywords in top trend',
                description: 'Top 10 / 20 / 50 counts over time',
                type: 'trend', props: { source: 'ahrefs', metrics: ['top_10_keywords', 'top_20_keywords', 'top_50_keywords'], title: 'Keywords in Top Positions' },
            },
            {
                key: 'domain_rating_trend', name: 'Domain Rating trend',
                description: 'Authority growth over time',
                type: 'trend', props: { source: 'ahrefs', metrics: ['domain_rating'], title: 'Domain Rating' },
            },
            {
                key: 'top_positions_distribution', name: 'Distribution by top positions',
                description: 'Keywords bucketed 1–10 / 11–20 / 21–50 / 51+',
                type: 'distribution', props: {},
            },
        ],
    },
    {
        name: 'Google Search Console',
        source: 'gsc',
        items: [
            {
                key: 'gsc_overview', name: 'Organic search overview',
                description: 'Clicks, impressions, CTR & position',
                type: 'metrics_overview', props: { source: 'gsc' },
            },
            {
                key: 'avg_position_trend', name: 'Average position trend',
                description: 'Ranking position over time (lower is better)',
                type: 'trend', props: { source: 'gsc', metrics: ['avg_position'], title: 'Average Position', invertY: true },
            },
            {
                key: 'clicks_impressions_trend', name: 'Clicks & impressions trend',
                description: 'Search performance over time',
                type: 'trend', props: { source: 'gsc', metrics: ['organic_clicks', 'impressions'], title: 'Clicks & Impressions' },
            },
        ],
    },
    {
        name: 'Google Analytics',
        source: 'ga4',
        items: [
            {
                key: 'ga4_overview', name: 'Traffic overview',
                description: 'Sessions, users & engagement',
                type: 'metrics_overview', props: { source: 'ga4' },
            },
            {
                key: 'traffic_trend', name: 'Traffic trend',
                description: 'Sessions & organic sessions over time',
                type: 'trend', props: { source: 'ga4', metrics: ['sessions', 'organic_sessions'], title: 'Traffic' },
            },
            {
                key: 'organic_table', name: 'Organic traffic table',
                description: 'Monthly organic history (GSC + GA4)',
                type: 'organic_table', props: {},
            },
        ],
    },
    {
        name: 'Local Presence',
        source: 'gbp',
        items: [
            {
                key: 'gbp_overview', name: 'Business Profile overview',
                description: 'Calls, directions, clicks & reviews',
                type: 'metrics_overview', props: { source: 'gbp' },
            },
        ],
    },
];

export interface FormattingItem {
    key: string;
    name: string;
    description: string;
    type: BlockType;
    props: Record<string, any>;
}

export const FORMATTING_ITEMS: FormattingItem[] = [
    { key: 'cover', name: 'Cover Page', description: 'Branded cover with logo, client & period', type: 'cover', props: {} },
    { key: 'title', name: 'Title', description: 'Section heading', type: 'title', props: { text: 'Section Title' } },
    { key: 'text', name: 'Text', description: 'Free-form paragraph', type: 'text', props: { field: null, label: null, content: '' } },
    { key: 'image', name: 'Image', description: 'Embed an image by URL', type: 'image', props: { url: '', caption: '' } },
    { key: 'page_break', name: 'Page break', description: 'Start a new page in the PDF', type: 'page_break', props: {} },
    {
        key: 'grid_comparison', name: 'Keyword Visibility Heatmaps', description: 'Before/after ranking grid screenshots, side-by-side or slider',
        type: 'grid_comparison', props: { viewMode: 'slider' },
    },
];

/** Human label for a block instance (canvas toolbar, template previews). */
export function blockLabel(block: Block): string {
    switch (block.type) {
        case 'cover': return 'Cover Page';
        case 'title': return 'Title';
        case 'text': return block.props.label || 'Text';
        case 'image': return 'Image';
        case 'page_break': return 'Page break';
        case 'metrics_overview': {
            const names: Record<string, string> = {
                gsc: 'Organic search overview', ga4: 'Traffic overview',
                gbp: 'Business Profile overview', ahrefs: 'Key ranking metrics',
            };
            return names[block.props.source] ?? 'Metrics overview';
        }
        case 'trend': return block.props.title ? `${block.props.title} trend` : 'Trend chart';
        case 'distribution': return 'Distribution by top positions';
        case 'organic_table': return 'Organic traffic table';
        case 'grid_comparison': return 'Keyword Visibility Heatmaps';
        default: return 'Block';
    }
}

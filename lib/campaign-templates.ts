import type {
    WorkstreamCategory, KpiGroup, KpiSource, ExpectationType,
} from './types';

export interface CampaignTemplate {
    key: string;
    name: string;
    description: string;
    strategyModel: string;
    workstreams: { name: string; category: WorkstreamCategory }[];
    phases: { name: string; phaseOrder: number; objective: string }[];
    suggestedKpis: { metricName: string; kpiGroup: KpiGroup; source: KpiSource }[];
    suggestedExpectations: { type: ExpectationType; statement: string; targetWindowDays: number }[];
}

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
    {
        key: 'local_seo_retainer',
        name: 'Local SEO Retainer',
        description: 'GBP optimization, local citations, local pages, review management, and local content.',
        strategyModel: 'local',
        workstreams: [
            { name: 'Google Business Profile', category: 'local_seo' },
            { name: 'Local Citations & Directories', category: 'local_seo' },
            { name: 'Local Landing Pages', category: 'content' },
            { name: 'Review Management', category: 'local_seo' },
            { name: 'Analytics & Tracking', category: 'analytics' },
            { name: 'Content Strategy', category: 'content' },
        ],
        phases: [
            { name: 'Setup & Baseline', phaseOrder: 0, objective: 'Audit current local presence, configure tracking, capture baselines.' },
            { name: 'GBP & Citations Cleanup', phaseOrder: 1, objective: 'Optimize GBP listing, fix NAP consistency, submit to directories.' },
            { name: 'Local Pages & Content', phaseOrder: 2, objective: 'Build city/service area pages, create local content calendar.' },
            { name: 'Authority & Reviews', phaseOrder: 3, objective: 'Launch review acquisition, build local backlinks.' },
            { name: 'Ongoing Optimization', phaseOrder: 4, objective: 'Monthly GBP posts, review responses, rank tracking, quarterly reassessment.' },
        ],
        suggestedKpis: [
            { metricName: 'GBP Profile Views', kpiGroup: 'visibility', source: 'gbp' },
            { metricName: 'GBP Actions (calls, directions, website)', kpiGroup: 'conversion', source: 'gbp' },
            { metricName: 'Local Pack Rankings', kpiGroup: 'visibility', source: 'manual' },
            { metricName: 'Organic Sessions (Local Pages)', kpiGroup: 'traffic', source: 'ga4' },
            { metricName: 'Citation Accuracy Score', kpiGroup: 'technical', source: 'manual' },
            { metricName: 'Review Count & Avg Rating', kpiGroup: 'authority', source: 'gbp' },
        ],
        suggestedExpectations: [
            { type: 'local', statement: 'Improve Local Pack visibility for priority service + location keywords.', targetWindowDays: 180 },
            { type: 'conversion', statement: 'Increase GBP-driven actions (calls, direction requests) month over month.', targetWindowDays: 180 },
        ],
    },
    {
        key: 'content_led_retainer',
        name: 'Content-Led SEO Retainer',
        description: 'Content strategy, blog production, internal linking, authority building, and analytics.',
        strategyModel: 'authority_relevance_trust',
        workstreams: [
            { name: 'Content Strategy & Briefs', category: 'content' },
            { name: 'Content Production', category: 'content' },
            { name: 'On-Page Optimization', category: 'on_page' },
            { name: 'Internal Linking', category: 'on_page' },
            { name: 'Authority & Link Building', category: 'authority' },
            { name: 'Analytics & Reporting', category: 'analytics' },
        ],
        phases: [
            { name: 'Setup & Baseline', phaseOrder: 0, objective: 'Configure tracking, audit existing content, capture keyword baselines.' },
            { name: 'Research & Strategy', phaseOrder: 1, objective: 'Keyword research, competitor content gap analysis, content calendar.' },
            { name: 'Foundation Content', phaseOrder: 2, objective: 'Publish pillar pages and first batch of supporting content.' },
            { name: 'Content & Authority Buildout', phaseOrder: 3, objective: 'Scale content production, begin link building, optimize internal links.' },
            { name: 'Expansion & Optimization', phaseOrder: 4, objective: 'Content refreshes, new topic clusters, advanced link building.' },
            { name: 'Ongoing Quarterly Review', phaseOrder: 5, objective: 'Reassess keyword targets, content performance, adjust strategy.' },
        ],
        suggestedKpis: [
            { metricName: 'Organic Sessions', kpiGroup: 'traffic', source: 'ga4' },
            { metricName: 'Organic Clicks', kpiGroup: 'traffic', source: 'gsc' },
            { metricName: 'Impressions', kpiGroup: 'visibility', source: 'gsc' },
            { metricName: 'Average Position (Target Keywords)', kpiGroup: 'visibility', source: 'gsc' },
            { metricName: 'Pages Published', kpiGroup: 'content', source: 'internal' },
            { metricName: 'Referring Domains', kpiGroup: 'authority', source: 'ahrefs' },
            { metricName: 'Organic Conversions', kpiGroup: 'conversion', source: 'ga4' },
        ],
        suggestedExpectations: [
            { type: 'traffic', statement: 'Grow organic traffic month over month through new and refreshed content.', targetWindowDays: 180 },
            { type: 'ranking', statement: 'Move priority keyword set toward top-10 positions.', targetWindowDays: 365 },
            { type: 'authority', statement: 'Increase referring domain count through link building and content promotion.', targetWindowDays: 180 },
        ],
    },
    {
        key: 'technical_growth',
        name: 'Technical + Growth Campaign',
        description: 'Technical audit, on-page optimization, keyword targeting, content refresh, CRO.',
        strategyModel: 'authority_relevance_trust',
        workstreams: [
            { name: 'Technical SEO Audit', category: 'technical_seo' },
            { name: 'On-Page Optimization', category: 'on_page' },
            { name: 'Keyword Targeting', category: 'research_strategy' },
            { name: 'Content Refresh', category: 'content' },
            { name: 'Authority Building', category: 'authority' },
            { name: 'CRO & Lead Quality', category: 'cro' },
        ],
        phases: [
            { name: 'Setup & Baseline', phaseOrder: 0, objective: 'Technical crawl, audit setup, baseline metrics.' },
            { name: 'Technical Fixes & Quick Wins', phaseOrder: 1, objective: 'Fix crawl issues, indexing, CWV, sitemap, robots. Optimize existing high-potential pages.' },
            { name: 'On-Page & Keyword Targeting', phaseOrder: 2, objective: 'Optimize title tags, meta, H1s, internal links for priority keywords.' },
            { name: 'Content Refresh & Authority', phaseOrder: 3, objective: 'Refresh underperforming content, launch link building.' },
            { name: 'CRO & Expansion', phaseOrder: 4, objective: 'Optimize conversion paths, landing pages, expand keyword targets.' },
            { name: 'Ongoing Optimization', phaseOrder: 5, objective: 'Quarterly technical health checks, content updates, rank tracking.' },
        ],
        suggestedKpis: [
            { metricName: 'Technical Issues Resolved', kpiGroup: 'technical', source: 'manual' },
            { metricName: 'Core Web Vitals (LCP, CLS, INP)', kpiGroup: 'technical', source: 'gsc' },
            { metricName: 'Index Coverage', kpiGroup: 'technical', source: 'gsc' },
            { metricName: 'Organic Traffic', kpiGroup: 'traffic', source: 'ga4' },
            { metricName: 'Keyword Rankings (Top 10 %)', kpiGroup: 'visibility', source: 'ahrefs' },
            { metricName: 'Conversion Rate', kpiGroup: 'conversion', source: 'ga4' },
            { metricName: 'Referring Domains', kpiGroup: 'authority', source: 'ahrefs' },
        ],
        suggestedExpectations: [
            { type: 'technical', statement: 'Resolve critical crawl and indexing issues within the first 60 days.', targetWindowDays: 60 },
            { type: 'ranking', statement: 'Improve ranking distribution for tracked keyword set.', targetWindowDays: 180 },
            { type: 'conversion', statement: 'Improve on-site conversion rate through CRO optimizations.', targetWindowDays: 365 },
        ],
    },
];

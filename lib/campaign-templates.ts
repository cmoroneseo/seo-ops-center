import type {
    WorkstreamCategory, KpiGroup, KpiSource, ExpectationType,
} from './types';

export interface RoadmapStageTemplate {
    title: string;
    monthRange: string;
    description: string;
    expectedOutcomes: string;
}

export interface SeoOverviewTemplate {
    artExplanation: string;
    currentState: string;
    opportunities: string;
    challenges: string;
    campaignObjectives: string;
}

export interface KeyActivityTemplate {
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    category: string;
}

export interface CampaignTemplate {
    key: string;
    name: string;
    description: string;
    strategyModel: string;
    workstreams: { name: string; category: WorkstreamCategory }[];
    phases: { name: string; phaseOrder: number; objective: string }[];
    suggestedKpis: { metricName: string; kpiGroup: KpiGroup; source: KpiSource }[];
    suggestedExpectations: { type: ExpectationType; statement: string; targetWindowDays: number }[];
    defaultSeoOverview?: SeoOverviewTemplate;
    defaultPreliminaryRoadmap?: RoadmapStageTemplate[];
    defaultKeyActivities?: KeyActivityTemplate[];
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
        defaultSeoOverview: {
            artExplanation: 'SEO is A.R.T. — Authority, Relevance, Trust. For local SEO, we improve Authority through local citations and backlinks, Relevance through optimized GBP listings and city-specific landing pages, and Trust through review management and consistent NAP data.',
            currentState: '',
            opportunities: '',
            challenges: '',
            campaignObjectives: 'Increase local visibility, drive GBP-sourced leads (calls, directions, website clicks), and establish dominant Local Pack presence in target service areas.',
        },
        defaultPreliminaryRoadmap: [
            { title: 'Research & Foundation', monthRange: 'Months 0-3', description: 'Audit current local presence across all target locations. Configure tracking for GBP, organic local traffic, and conversions. Fix NAP inconsistencies and claim/optimize all GBP listings.', expectedOutcomes: 'Clean GBP profiles, accurate citations, baseline metrics established.' },
            { title: 'Optimization & Expansion', monthRange: 'Months 3-6', description: 'Build city/service area landing pages. Launch local content calendar. Begin review acquisition strategy. Submit to key local directories.', expectedOutcomes: 'Local pages indexed and ranking, review count growing, citation score improving.' },
            { title: 'Authority & Growth', monthRange: 'Months 6-12', description: 'Build local backlinks. Scale content production. Optimize based on ranking data. Expand to additional service areas as visibility grows.', expectedOutcomes: 'Consistent Local Pack appearances, measurable increase in GBP-driven leads.' },
        ],
        defaultKeyActivities: [
            { title: 'GBP Optimization & Monthly Posts', description: 'Complete GBP audit, optimize all fields, establish monthly posting cadence.', priority: 'high', category: 'local_seo' },
            { title: 'Citation Cleanup & Submissions', description: 'Fix NAP inconsistencies, submit to top local directories.', priority: 'high', category: 'local_seo' },
            { title: 'Local Landing Pages', description: 'Build city/service area pages targeting local search intent.', priority: 'high', category: 'content' },
            { title: 'Review Acquisition Strategy', description: 'Implement review generation process for key locations.', priority: 'medium', category: 'local_seo' },
            { title: 'Analytics & Tracking Setup', description: 'Configure GA4 goals, GBP tracking, call tracking, form submission tracking.', priority: 'high', category: 'analytics' },
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
        defaultSeoOverview: {
            artExplanation: 'SEO is A.R.T. — Authority, Relevance, Trust. This campaign builds Authority through strategic link building and content promotion, Relevance through keyword-targeted content and on-page optimization, and Trust through consistent publishing and technical excellence.',
            currentState: '',
            opportunities: '',
            challenges: '',
            campaignObjectives: 'Grow organic traffic and conversions through a content-led strategy supported by authority building and on-page optimization.',
        },
        defaultPreliminaryRoadmap: [
            { title: 'Research & Strategy', monthRange: 'Months 0-3', description: 'Keyword research, competitor content gap analysis, content calendar development. Configure tracking and capture baseline metrics.', expectedOutcomes: 'Content strategy documented, editorial calendar built, baselines established.' },
            { title: 'Content & Authority Buildout', monthRange: 'Months 3-6', description: 'Publish pillar pages and supporting content. Begin link building and outreach. Optimize internal linking structure.', expectedOutcomes: 'Pillar content published, early ranking improvements, growing backlink profile.' },
            { title: 'Expansion & Optimization', monthRange: 'Months 6-12', description: 'Scale content production. Refresh underperforming pages. Expand topic clusters. Advanced link building.', expectedOutcomes: 'Sustained traffic growth, strong keyword portfolio, measurable conversion increases.' },
        ],
        defaultKeyActivities: [
            { title: 'Keyword Research & Content Calendar', description: 'Research target keywords, map to content types, build editorial calendar.', priority: 'high', category: 'content' },
            { title: 'Pillar Page Development', description: 'Create comprehensive pillar pages for primary topic clusters.', priority: 'high', category: 'content' },
            { title: 'Blog Content Production', description: 'Ongoing blog posts targeting supporting keywords.', priority: 'high', category: 'content' },
            { title: 'Internal Linking Optimization', description: 'Build topic cluster internal link architecture.', priority: 'medium', category: 'on_page' },
            { title: 'Link Building & Outreach', description: 'Strategic outreach for quality backlinks to pillar content.', priority: 'medium', category: 'authority' },
            { title: 'Analytics & Reporting Setup', description: 'Configure GA4 goals, GSC verification, content performance dashboards.', priority: 'high', category: 'analytics' },
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
        defaultSeoOverview: {
            artExplanation: 'SEO is A.R.T. — Authority, Relevance, Trust. This campaign focuses first on Trust through technical fixes and CWV improvements, then builds Relevance through on-page optimization and keyword targeting, and develops Authority through content refresh and strategic link building.',
            currentState: '',
            opportunities: '',
            challenges: '',
            campaignObjectives: 'Fix technical SEO foundation, optimize existing pages for target keywords, improve conversion rate, and build domain authority through content and link building.',
        },
        defaultPreliminaryRoadmap: [
            { title: 'Technical Fixes & Quick Wins', monthRange: 'Months 0-3', description: 'Complete technical crawl and audit. Fix crawl issues, indexing problems, CWV failures. Optimize metadata and on-page elements for high-potential pages.', expectedOutcomes: 'Clean crawl, improved CWV scores, quick ranking gains from on-page fixes.' },
            { title: 'Content & Authority Buildout', monthRange: 'Months 3-6', description: 'Refresh underperforming content. Launch link building campaign. Optimize internal linking. Begin keyword expansion targeting.', expectedOutcomes: 'Content refreshes driving traffic, growing backlink profile, broader keyword visibility.' },
            { title: 'CRO & Expansion', monthRange: 'Months 6-12', description: 'Optimize conversion paths and landing pages. Expand keyword targets. Scale content and link building. Quarterly technical health checks.', expectedOutcomes: 'Improved conversion rates, sustained traffic growth, strong technical foundation.' },
        ],
        defaultKeyActivities: [
            { title: 'Technical SEO Audit', description: 'Full crawl audit covering indexing, crawl errors, CWV, sitemap, robots.txt.', priority: 'high', category: 'technical_seo' },
            { title: 'Metadata Optimization', description: 'Title tags, meta descriptions, H1s for priority pages.', priority: 'high', category: 'on_page' },
            { title: 'Content Refresh Program', description: 'Identify and update underperforming pages with current data and keywords.', priority: 'medium', category: 'content' },
            { title: 'Link Building Campaign', description: 'Strategic outreach for quality backlinks to key pages.', priority: 'medium', category: 'authority' },
            { title: 'CRO Analysis & Implementation', description: 'Audit conversion paths, optimize landing pages, test CTAs.', priority: 'medium', category: 'cro' },
            { title: 'Analytics & Tracking Setup', description: 'Configure GA4 goals, conversion tracking, GSC verification.', priority: 'high', category: 'analytics' },
        ],
    },
];

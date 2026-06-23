export interface ScopeActivity {
    key: string;
    label: string;
    category: string;
    minHours: number;
    maxHours: number;
    frequency: 'one_time' | 'monthly' | 'quarterly';
}

export const SEO_ACTIVITIES: ScopeActivity[] = [
    // Research & Strategy
    { key: 'keyword_research', label: 'Keyword Research & Strategy', category: 'Research & Strategy', minHours: 4, maxHours: 8, frequency: 'one_time' },
    { key: 'competitor_analysis', label: 'Competitor Analysis', category: 'Research & Strategy', minHours: 3, maxHours: 6, frequency: 'one_time' },
    { key: 'content_strategy', label: 'Content Strategy & Calendar', category: 'Research & Strategy', minHours: 3, maxHours: 5, frequency: 'quarterly' },

    // Technical SEO
    { key: 'technical_audit', label: 'Technical SEO Audit', category: 'Technical SEO', minHours: 4, maxHours: 10, frequency: 'one_time' },
    { key: 'cwv_optimization', label: 'Core Web Vitals Optimization', category: 'Technical SEO', minHours: 3, maxHours: 6, frequency: 'one_time' },
    { key: 'sitemap_robots', label: 'Sitemap & Robots.txt Setup', category: 'Technical SEO', minHours: 1, maxHours: 2, frequency: 'one_time' },
    { key: 'schema_markup', label: 'Schema Markup Implementation', category: 'Technical SEO', minHours: 2, maxHours: 4, frequency: 'one_time' },
    { key: 'indexing_fixes', label: 'Crawl & Indexing Fixes', category: 'Technical SEO', minHours: 2, maxHours: 5, frequency: 'monthly' },

    // On-Page
    { key: 'metadata_optimization', label: 'Title Tags & Meta Descriptions', category: 'On-Page', minHours: 2, maxHours: 4, frequency: 'monthly' },
    { key: 'header_optimization', label: 'H1/H2 & Content Structure', category: 'On-Page', minHours: 1, maxHours: 3, frequency: 'monthly' },
    { key: 'internal_linking', label: 'Internal Linking Optimization', category: 'On-Page', minHours: 2, maxHours: 4, frequency: 'monthly' },
    { key: 'image_optimization', label: 'Image Optimization & Alt Text', category: 'On-Page', minHours: 1, maxHours: 2, frequency: 'monthly' },

    // Content
    { key: 'blog_post', label: 'Blog Post (1)', category: 'Content', minHours: 3, maxHours: 5, frequency: 'monthly' },
    { key: 'service_page', label: 'Service Page (1)', category: 'Content', minHours: 4, maxHours: 6, frequency: 'one_time' },
    { key: 'city_page', label: 'City/Location Page (1)', category: 'Content', minHours: 3, maxHours: 5, frequency: 'one_time' },
    { key: 'content_refresh', label: 'Content Refresh (1 page)', category: 'Content', minHours: 2, maxHours: 3, frequency: 'monthly' },
    { key: 'landing_page', label: 'Landing Page (1)', category: 'Content', minHours: 4, maxHours: 7, frequency: 'one_time' },

    // Authority / Link Building
    { key: 'link_building', label: 'Link Building & Outreach', category: 'Authority', minHours: 4, maxHours: 8, frequency: 'monthly' },
    { key: 'citation_building', label: 'Local Citation Building', category: 'Authority', minHours: 2, maxHours: 4, frequency: 'one_time' },
    { key: 'directory_submissions', label: 'Directory Submissions', category: 'Authority', minHours: 2, maxHours: 3, frequency: 'one_time' },

    // Local SEO
    { key: 'gbp_optimization', label: 'GBP Optimization', category: 'Local SEO', minHours: 2, maxHours: 4, frequency: 'one_time' },
    { key: 'gbp_monthly', label: 'GBP Monthly Posts & Updates', category: 'Local SEO', minHours: 1, maxHours: 2, frequency: 'monthly' },
    { key: 'review_management', label: 'Review Management Strategy', category: 'Local SEO', minHours: 1, maxHours: 2, frequency: 'monthly' },

    // Analytics
    { key: 'analytics_setup', label: 'GA4 & GSC Setup/Audit', category: 'Analytics', minHours: 2, maxHours: 4, frequency: 'one_time' },
    { key: 'conversion_tracking', label: 'Conversion Tracking Setup', category: 'Analytics', minHours: 2, maxHours: 4, frequency: 'one_time' },
    { key: 'monthly_reporting', label: 'Monthly Reporting & Analysis', category: 'Analytics', minHours: 2, maxHours: 3, frequency: 'monthly' },

    // CRO
    { key: 'cro_audit', label: 'CRO Audit', category: 'CRO', minHours: 3, maxHours: 6, frequency: 'one_time' },
    { key: 'cta_optimization', label: 'CTA & Form Optimization', category: 'CRO', minHours: 2, maxHours: 3, frequency: 'quarterly' },
];

export function getActivityAvgHours(activity: ScopeActivity): number {
    return (activity.minHours + activity.maxHours) / 2;
}

import type { TopicalMapProfile } from '../types';

export interface GenerationContext {
    profile: TopicalMapProfile;
    existingPages: Array<{ url: string; title?: string; h1s: string[]; wordCount?: number }>;
    gscQueries: Array<{ query: string; clicks: number; impressions: number; position: number }>;
    clientDomain: string;
}

export function buildSystemPrompt(): string {
    return `You are an expert SEO content strategist. Your job is to create a comprehensive topical authority map for a website.

A topical map organizes all the content a website should have into silos (topic clusters). Each silo has a hub page and supporting pages/posts.

For each record, specify:
- page_type: one of pillar, service, landing, product, collection, city, blog_post, guide, faq, resource_center, knowledge_base, homepage, comparison, case_study, other
- content_category: a short industry-specific label in lowercase (e.g., "roofing", "personal injury", "crm")
- target_query: the primary keyword this page should rank for
- title: the full page title / H1
- word_count_min and word_count_max: recommended word count range
- build_phase: 1 = most important, build first; 2 = second wave; 3 = nice to have
- search_volume_monthly: estimated monthly search volume (your best estimate)
- keyword_difficulty: 0-100 difficulty score (your best estimate)
- scope_exclusions: URLs this page should NOT compete with (cannibalization prevention)
- outgoing_links: internal links this page should contain (anchor_text + destination page title)
- suggested_url: recommended URL path for this page
- parent_title: if this is a supporting page, the title of its parent page (for nesting)

Group pages into silos. Each silo should have:
- name: the topic cluster name
- description: one-line purpose
- hub_url: existing or suggested hub page URL
- search_intent: transactional, commercial, informational, or navigational

Generate 30-60 records across 4-8 silos. Prioritize pages that will move the needle for the business. Be concise — short titles, no verbose descriptions.

Respond with valid JSON matching the schema provided.`;
}

export function buildUserMessage(ctx: GenerationContext): string {
    const existingSummary = ctx.existingPages.length > 0
        ? `\n\nExisting pages (${ctx.existingPages.length} total):\n${ctx.existingPages.slice(0, 50).map(p =>
            `- ${p.url} | "${p.title ?? 'no title'}" | ${p.wordCount ?? 0} words`
        ).join('\n')}`
        : '\n\nNo existing pages crawled yet.';

    const gscSummary = ctx.gscQueries.length > 0
        ? `\n\nTop GSC queries (${ctx.gscQueries.length} total):\n${ctx.gscQueries.slice(0, 50).map(q =>
            `- "${q.query}" | ${q.clicks} clicks | ${q.impressions} impressions | pos ${q.position.toFixed(1)}`
        ).join('\n')}`
        : '\n\nNo GSC data available.';

    return `Create a topical authority map for this business:

**Brand:** ${ctx.profile.brandName}
**Domain:** ${ctx.clientDomain}
**Description:** ${ctx.profile.businessDescription}
**Language:** ${ctx.profile.contentLanguage}
**Focus Topics:** ${ctx.profile.focusTopics.join(', ')}
**Competitors:** ${ctx.profile.rivals.join(', ')}
${existingSummary}
${gscSummary}`;
}

export const GENERATION_SCHEMA = {
    type: 'object' as const,
    properties: {
        architecture_summary: { type: 'string' as const },
        silos: {
            type: 'array' as const,
            items: {
                type: 'object' as const,
                properties: {
                    name: { type: 'string' as const },
                    description: { type: 'string' as const },
                    hub_url: { type: 'string' as const },
                    search_intent: { type: 'string' as const, enum: ['transactional', 'commercial', 'informational', 'navigational'] },
                    records: {
                        type: 'array' as const,
                        items: {
                            type: 'object' as const,
                            properties: {
                                page_type: { type: 'string' as const },
                                content_category: { type: 'string' as const },
                                title: { type: 'string' as const },
                                target_query: { type: 'string' as const },
                                word_count_min: { type: 'number' as const },
                                word_count_max: { type: 'number' as const },
                                build_phase: { type: 'number' as const },
                                search_volume_monthly: { type: 'number' as const },
                                keyword_difficulty: { type: 'number' as const },
                                suggested_url: { type: 'string' as const },
                                parent_title: { type: 'string' as const },
                                scope_exclusions: { type: 'array' as const, items: { type: 'object' as const, properties: { url: { type: 'string' as const }, reason: { type: 'string' as const } } } },
                                outgoing_links: { type: 'array' as const, items: { type: 'object' as const, properties: { anchor_text: { type: 'string' as const }, destination_title: { type: 'string' as const } } } },
                            },
                            required: ['page_type', 'title', 'target_query', 'word_count_min', 'word_count_max', 'build_phase'],
                        },
                    },
                },
                required: ['name', 'description', 'search_intent', 'records'],
            },
        },
    },
    required: ['architecture_summary', 'silos'],
};

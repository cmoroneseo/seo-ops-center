import type { TopicalMapProfile } from '../types';

export interface GenerationContext {
    profile: TopicalMapProfile;
    existingPages: Array<{ url: string; title?: string; h1s: string[]; wordCount?: number }>;
    gscQueries: Array<{ query: string; clicks: number; impressions: number; position: number }>;
    clientDomain: string;
}

export function buildSystemPrompt(): string {
    return `You are a senior SEO strategist building a topical authority map. Your maps win because they go beyond generic service pages — they capture the long-tail queries that build real topical authority and drive conversions.

## Your job

Create a comprehensive topical map organized into silos (topic clusters). Each silo has a pillar page, supporting service/landing pages, and long-tail content (guides, blog posts, FAQs) that builds depth.

## Quality standards

1. **Niche down titles.** Never write generic titles like "SEO Services for Business Growth." Instead, incorporate the brand's actual service areas, location, or industry verticals. Use the existing pages and GSC queries to understand what angles they already pursue.

2. **Cover the full funnel.** Each silo needs:
   - Top-of-funnel: educational guides, how-to content, "what is X" posts
   - Mid-funnel: comparison pages ("X vs Y"), cost/pricing guides, case studies, checklists
   - Bottom-of-funnel: service pages, landing pages, free consultation/audit offers

3. **Go deep on long-tail.** Don't stop at head terms. For each service area, add specific sub-topics: industry-specific pages, location pages, problem-specific pages, process explainers. A silo with only 3-4 pages is too thin.

4. **Use GSC data.** The user's actual search queries are provided. Build records around queries they already rank for (to strengthen) AND queries they should rank for but don't (to capture). Reference real query patterns, not imagined ones.

5. **Internal linking.** Every supporting page should link back to its pillar and to 1-2 sibling pages. Use the outgoing_links field with the exact title of the destination page.

6. **Parent-child hierarchy.** Use parent_title to create subtopic clusters within silos — e.g., a "Local SEO" service page is the parent of "Local SEO for Dentists" and "Local SEO for Restaurants."

7. **Estimate search metrics.** Provide your best estimate for search_volume_monthly and keyword_difficulty (0-100) based on the keyword. These are rough estimates to help prioritize — don't leave them null.

## Target volume

Generate **40-70 records** across **4-7 silos**. Aim for 8-15 records per silo. Quality over quantity, but a real topical authority map needs depth.

## JSON structure

Respond ONLY with valid JSON, no markdown fencing, no text outside the JSON:

{
  "architecture_summary": "3-4 sentence strategy overview: what silos cover, how they interlink, and the competitive angle",
  "silos": [
    {
      "name": "Silo Name",
      "description": "One-line purpose and intent",
      "search_intent": "commercial",
      "hub_url": "/silo-hub-page",
      "records": [
        {
          "page_type": "pillar",
          "title": "Specific, Non-Generic Page Title",
          "target_query": "exact target keyword phrase",
          "suggested_url": "/url-path",
          "word_count_min": 1500,
          "word_count_max": 2500,
          "build_phase": 1,
          "content_category": "evergreen",
          "search_volume_monthly": 1200,
          "keyword_difficulty": 45,
          "parent_title": null,
          "outgoing_links": [
            {"anchor_text": "link text", "destination_title": "Title of Target Page"}
          ]
        }
      ]
    }
  ]
}

## Field reference

- page_type: pillar | service | landing | product | blog_post | guide | faq | other
- search_intent: transactional | commercial | informational | navigational
- content_category: evergreen | seasonal | news | comparison | case_study
- build_phase: 1 (launch priority) | 2 (month 2-3) | 3 (month 4+)
- parent_title: exact title of the parent record in the same silo, or null
- outgoing_links: array of internal links to other records (by title)
- search_volume_monthly: estimated monthly search volume (integer)
- keyword_difficulty: 0-100 difficulty score estimate`;
}

export function buildUserMessage(ctx: GenerationContext): string {
    const existingSummary = ctx.existingPages.length > 0
        ? `\n\n## Existing pages on the site (${ctx.existingPages.length} total)\nThese pages already exist. The map should reference them where relevant (the system will auto-match via URL). Build NEW content around gaps these pages don't cover.\n${ctx.existingPages.slice(0, 40).map(p =>
            `- ${p.url} | "${p.title ?? 'no title'}" | ${p.wordCount ?? 0} words`
        ).join('\n')}`
        : '\n\n## Existing pages\nNo pages crawled yet — this is a new site or no crawl data is available. Build the full content architecture from scratch.';

    const gscSummary = ctx.gscQueries.length > 0
        ? `\n\n## Google Search Console queries (${ctx.gscQueries.length} total)\nThese are REAL queries people use to find this site. Use them to:\n- Create records targeting high-impression/low-click queries (opportunity gaps)\n- Strengthen existing rankings for high-click queries\n- Discover topic clusters from query patterns\n${ctx.gscQueries.slice(0, 40).map(q =>
            `- "${q.query}" | ${q.clicks} clicks | ${q.impressions} impr | pos ${q.position.toFixed(1)}`
        ).join('\n')}`
        : '\n\n## Google Search Console\nNo GSC data available. Build the map based on the business description, competitors, and industry best practices.';

    const focusLine = ctx.profile.focusTopics.length > 0
        ? `**Focus Topics:** ${ctx.profile.focusTopics.join(', ')}`
        : '**Focus Topics:** None specified — infer from the business description and existing pages';

    const rivalsLine = ctx.profile.rivals.length > 0
        ? `**Competitors:** ${ctx.profile.rivals.join(', ')} — study what topics they likely cover and find angles they miss`
        : '**Competitors:** None specified';

    return `Build a topical authority map for this business. Remember: go deep, not wide. Each silo needs 8-15 records covering the full buyer journey.

## Business profile
**Brand:** ${ctx.profile.brandName}
**Domain:** ${ctx.clientDomain || 'Not specified'}
**Description:** ${ctx.profile.businessDescription}
**Language:** ${ctx.profile.contentLanguage}
${focusLine}
${rivalsLine}
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
                    search_intent: { type: 'string' as const, enum: ['transactional', 'commercial', 'informational', 'navigational'] },
                    records: {
                        type: 'array' as const,
                        items: {
                            type: 'object' as const,
                            properties: {
                                page_type: { type: 'string' as const },
                                title: { type: 'string' as const },
                                target_query: { type: 'string' as const },
                                word_count_min: { type: 'number' as const },
                                word_count_max: { type: 'number' as const },
                                build_phase: { type: 'number' as const },
                                suggested_url: { type: 'string' as const },
                            },
                            required: ['page_type', 'title', 'target_query', 'build_phase'],
                        },
                    },
                },
                required: ['name', 'description', 'search_intent', 'records'],
            },
        },
    },
    required: ['architecture_summary', 'silos'],
};

import type { TopicalMapProfile } from '../types';
import { PAGE_KINDS } from './page-mix';
import { normalizeSeedKeywords } from './seed-keywords';

export interface GenerationContext {
    profile: TopicalMapProfile;
    existingPages: Array<{ url: string; title?: string; h1s: string[]; wordCount?: number }>;
    /** Searches grouped by intent, most impressions first (see clusterQueryFacts). Only the top GSC_PROMPT_GROUPS are shown. */
    gscQueries: Array<{ query: string; clicks: number; impressions: number; position: number; variants?: string[] }>;
    /** Stored days the searches cover. */
    gscDays?: number;
    clientDomain: string;
    /** Chosen searches. Omitted or empty leaves the prompt unchanged. */
    seedKeywords?: readonly string[];
}

/** Search groups shown to the model. Bounds the prompt; the page-mix check still sees every group. */
export const GSC_PROMPT_GROUPS = 60;

export function buildSystemPrompt(): string {
    return `You are a senior local SEO strategist building a topical map for a business. The map exists to win customers: money pages first, and articles only where buyers really search for them.

## Page types (page_type must be one of these)

- service: one page per real service the business sells that has search demand
- sub_service: a specialty within a service with its own demand (for example pet turf or putting greens under artificial turf)
- service_city: one service in one city
- city: a city hub that links that city's service_city pages
- cost: what the service costs
- comparison: X vs Y between options a buyer is choosing between
- faq: one real question a buyer asks before hiring
- local_resource: local permits, rebates or rules that affect the job

## Rules

1. **Money pages first.** service, sub_service and service_city pages come before any article. Build phase 1 is money pages only.
2. **Only what they sell.** One service page per real service with demand. Never create pages for services the business does not sell (check the description, focus topics and existing pages).
3. **Service + city only with evidence.** A service_city page needs both: the business serves that city, AND the Search Console list shows impressions for that service in that city or for the city itself. The first wave is the top 3-5 cities by impressions times the top 2-3 services, never the full city-by-service matrix.
4. **City hubs.** A city page only when the map has 2 or more service_city pages for that city.
5. **Articles at most 30%.** Articles are cost, comparison, faq and local_resource. Write only cost pages, X vs Y comparisons, real buyer questions, or permits and rebates. No general blog posts, how-to guides or "what is X" posts.
6. **Cite demand.** demand_query is the exact search from the Search Console list that shows demand for the page. When no listed search supports the page (for example it comes only from the keywords to cover), set demand_query to null and seed_only to true. At most 20% of records may be seed_only. The system checks every citation against Search Console and removes ideas over these limits.
7. **One primary search per page.** Each record has one target_query and 3-10 supporting_queries (other wordings and close searches the same page should answer), preferably from the Search Console list. No two records may target the same search, even worded differently.
8. **Existing pages.** Do not propose a new page for a search an existing page already targets.
9. **Niche titles.** Use the brand's real services, cities and customers in titles. Never generic titles.
10. **Structure.** 3-6 silos, usually one per core service. Use parent_title for hierarchy (service to sub_service or service_city, city to service_city) and 0-2 outgoing_links per record to other records by exact title.

Do not estimate search volume, keyword difficulty, or traffic. Those fields are not part of this map. Omit them.

## HARD REQUIREMENTS (non-negotiable)

1. 20-40 records. Never more than 40. A short map of real money pages beats a long list of articles.
2. Every record has page_type, title, target_query, supporting_queries, demand_query (or null), seed_only and build_phase.
3. Do NOT include search_volume_monthly, keyword_difficulty, or traffic estimates.

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
          "page_type": "service",
          "title": "Artificial Turf Installation in the Inland Empire",
          "target_query": "artificial turf installation",
          "supporting_queries": ["synthetic grass installers", "artificial lawn installation", "turf installation company"],
          "demand_query": "artificial turf installation",
          "seed_only": false,
          "suggested_url": "/artificial-turf-installation",
          "word_count_min": 1200,
          "word_count_max": 1800,
          "build_phase": 1,
          "parent_title": null,
          "outgoing_links": [
            {"anchor_text": "turf installation in Temecula", "destination_title": "Artificial Turf Installation in Temecula"}
          ]
        },
        {
          "page_type": "service_city",
          "title": "Artificial Turf Installation in Temecula",
          "target_query": "artificial turf temecula",
          "supporting_queries": ["synthetic grass temecula", "turf installers temecula", "artificial lawn temecula ca"],
          "demand_query": "artificial turf temecula",
          "seed_only": false,
          "suggested_url": "/temecula/artificial-turf",
          "word_count_min": 900,
          "word_count_max": 1400,
          "build_phase": 1,
          "parent_title": "Artificial Turf Installation in the Inland Empire",
          "outgoing_links": []
        }
      ]
    }
  ]
}

## Field values

- page_type: service | sub_service | service_city | city | cost | comparison | faq | local_resource
- search_intent: transactional | commercial | informational | navigational
- supporting_queries: 3-10 short searches
- demand_query: exact search from the Search Console list, or null
- seed_only: true only when demand_query is null
- build_phase: 1 (launch priority) | 2 (month 2-3) | 3 (month 4+)
- parent_title: exact title of the parent record in the same silo, or null for top-level pages
- outgoing_links: array of internal links to other records by their exact title
- Do not output search volume, keyword difficulty, or estimated traffic`;
}

export function buildUserMessage(ctx: GenerationContext): string {
    const existingSummary = ctx.existingPages.length > 0
        ? `\n\n## Existing pages on the site (${ctx.existingPages.length} total)\nThese pages already exist. The map should reference them where relevant (the system will auto-match via URL). Build NEW content around gaps these pages don't cover.\n${ctx.existingPages.slice(0, 40).map(p =>
            `- ${p.url} | "${p.title ?? 'no title'}" | ${p.wordCount ?? 0} words`
        ).join('\n')}`
        : '\n\n## Existing pages\nNo pages crawled yet — this is a new site or no crawl data is available. Build the full content architecture from scratch.';

    const listed = ctx.gscQueries.slice(0, GSC_PROMPT_GROUPS);
    const gscSummary = listed.length > 0
        ? `\n\n## Google Search Console searches (last ${ctx.gscDays ?? 90} days, grouped by intent, top ${listed.length} of ${ctx.gscQueries.length} by impressions)\nThese are REAL searches that showed this site. Each line is one search with its other wordings. Cite the first search of a line as demand_query. A high-impression search at a poor position with no matching page is a gap to fill first.\n${listed.map(q =>
            `- "${q.query}" | ${q.clicks} clicks | ${q.impressions} impr | pos ${q.position.toFixed(1)}${q.variants?.length ? ` | also: ${q.variants.map(v => `"${v}"`).join(', ')}` : ''}`
        ).join('\n')}`
        : '\n\n## Google Search Console\nNo GSC data available. Build the map from the business description, focus topics and existing pages; mark every record seed_only with demand_query null.';

    const focusLine = ctx.profile.focusTopics.length > 0
        ? `**Focus Topics:** ${ctx.profile.focusTopics.join(', ')}`
        : '**Focus Topics:** None specified — infer from the business description and existing pages';

    const rivalsLine = ctx.profile.rivals.length > 0
        ? `**Competitors:** ${ctx.profile.rivals.join(', ')} — study what topics they likely cover and find angles they miss`
        : '**Competitors:** None specified';

    const seedKeywords = normalizeSeedKeywords(ctx.seedKeywords);
    const seedLine = seedKeywords.length > 0
        ? `\n**Keywords to cover:** ${seedKeywords.join(', ')}\nBuild pages around these searches. Do not invent monthly searches or difficulty. A page backed only by this list, with no Search Console search, is seed_only.`
        : '';

    return `Build a topical map for this business. Money pages first, then only the articles buyers search for. Follow the page-type rules and limits.

## Business profile
**Brand:** ${ctx.profile.brandName}
**Domain:** ${ctx.clientDomain || 'Not specified'}
**Description:** ${ctx.profile.businessDescription}
**Language:** ${ctx.profile.contentLanguage}
${focusLine}
${rivalsLine}${seedLine}
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
                                page_type: { type: 'string' as const, enum: [...PAGE_KINDS] },
                                title: { type: 'string' as const },
                                target_query: { type: 'string' as const },
                                supporting_queries: { type: 'array' as const, items: { type: 'string' as const }, minItems: 3, maxItems: 10 },
                                demand_query: { type: ['string', 'null'] as const },
                                seed_only: { type: 'boolean' as const },
                                word_count_min: { type: 'number' as const },
                                word_count_max: { type: 'number' as const },
                                build_phase: { type: 'number' as const },
                                suggested_url: { type: 'string' as const },
                            },
                            required: ['page_type', 'title', 'target_query', 'supporting_queries', 'demand_query', 'seed_only', 'build_phase'],
                        },
                    },
                },
                required: ['name', 'description', 'search_intent', 'records'],
            },
        },
    },
    required: ['architecture_summary', 'silos'],
};

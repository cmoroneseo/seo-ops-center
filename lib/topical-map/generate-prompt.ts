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

Generate 15-25 records across 3-5 silos. Respond ONLY with valid JSON matching this exact structure:

{
  "architecture_summary": "2-3 sentence overview of the content strategy",
  "silos": [
    {
      "name": "Topic Cluster Name",
      "description": "One-line purpose",
      "search_intent": "commercial",
      "records": [
        {
          "page_type": "pillar",
          "title": "Page Title / H1",
          "target_query": "primary keyword",
          "word_count_min": 1500,
          "word_count_max": 2500,
          "build_phase": 1,
          "suggested_url": "/url-path"
        }
      ]
    }
  ]
}

Field values:
- page_type: pillar | service | landing | product | blog_post | guide | faq | other
- search_intent: transactional | commercial | informational | navigational
- build_phase: 1 (highest priority), 2, or 3

No markdown fencing. No text outside the JSON object.`;
}

export function buildUserMessage(ctx: GenerationContext): string {
    const existingSummary = ctx.existingPages.length > 0
        ? `\n\nExisting pages (${ctx.existingPages.length} total):\n${ctx.existingPages.slice(0, 25).map(p =>
            `- ${p.url} | "${p.title ?? 'no title'}" | ${p.wordCount ?? 0} words`
        ).join('\n')}`
        : '\n\nNo existing pages crawled yet.';

    const gscSummary = ctx.gscQueries.length > 0
        ? `\n\nTop GSC queries (${ctx.gscQueries.length} total):\n${ctx.gscQueries.slice(0, 25).map(q =>
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

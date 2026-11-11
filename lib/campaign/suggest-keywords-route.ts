/**
 * AI keyword ideas. Only a member of the client's organization may ask,
 * so the Anthropic key is never spent for an anonymous caller.
 */

type ClientAuth =
    | { ok: true; userId: string; organizationId: string; clientId: string; role: 'owner' | 'admin' | 'member' | 'viewer' }
    | { ok: false; status: number; error: string };

export interface SuggestKeywordsInput {
    system: string;
    prompt: string;
}

export interface SuggestKeywordsDeps {
    requireClientOrgMember: (clientId: unknown) => Promise<ClientAuth>;
    /** Returns the model's text reply, or null when no API key is configured. */
    complete: ((input: SuggestKeywordsInput) => Promise<string>) | null;
}

const SYSTEM = `You are an SEO keyword researcher. Generate keyword opportunities for a local/regional business based on their services and locations.

Return valid JSON only — no markdown, no commentary. The JSON must be an array of objects:
[
  {
    "keyword": "exact search phrase",
    "volume": estimated monthly search volume (integer, your best estimate),
    "difficulty": estimated keyword difficulty 0-100 (integer),
    "priority": "high" | "medium" | "low",
    "cluster": "topic cluster name"
  }
]

Guidelines:
- Generate 15-25 keyword opportunities
- Include a mix of: service keywords, location + service combinations, question-based queries, long-tail variations
- Prioritize bottom-of-funnel (high commercial intent) keywords as "high" priority
- Include informational keywords as "medium" or "low" priority
- Group keywords into logical topic clusters (e.g., "Core Services", "Location Pages", "FAQ/Educational")
- Volume estimates should be reasonable for local/regional businesses — don't inflate
- Difficulty estimates should reflect realistic competition for a local business`;

function list(value: unknown, limit: number): string[] {
    return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, limit) : [];
}

export function suggestKeywordsPrompt(body: Record<string, unknown>): string {
    const rivalList = list(body.rivals, 8);
    const topicList = list(body.focusTopics, 12);
    const serviceList = Array.isArray(body.services) ? body.services.join(', ') : (body.services as string) || 'Not specified';
    const locationList = Array.isArray(body.locations) ? body.locations.join(', ') : (body.locations as string) || 'Not specified';
    return `Generate SEO keyword opportunities for:
Business: ${body.brandName || body.clientName || 'Unknown'}
Industry: ${body.businessDescription || body.industry || 'Unknown'}
Services: ${serviceList}
Locations: ${locationList}${topicList.length ? `\nFocus topics: ${topicList.join(', ')}` : ''}${rivalList.length ? `\nCompetitors: ${rivalList.join(', ')}` : ''}`;
}

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
}

export function createSuggestKeywordsHandler(deps: SuggestKeywordsDeps) {
    return {
        async POST(req: Request): Promise<Response> {
            let body: Record<string, unknown>;
            try {
                const parsed = await req.json();
                body = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
            } catch {
                return json({ error: 'Invalid request body' }, 400);
            }

            const auth = await deps.requireClientOrgMember(body.clientId);
            if (!auth.ok) return json({ error: auth.error }, auth.status);

            if (!deps.complete) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

            try {
                const text = await deps.complete({ system: SYSTEM, prompt: suggestKeywordsPrompt(body) });
                const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                return json({ keywords: JSON.parse(cleaned), source: 'ai_suggested' });
            } catch (error) {
                console.error('suggest-keywords error:', error);
                return json({ error: 'Failed to generate keywords' }, 500);
            }
        },
    };
}

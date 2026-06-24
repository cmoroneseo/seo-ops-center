import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
    }

    const { services, locations, industry, clientName } = await req.json();

    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `You are an SEO keyword researcher. Generate keyword opportunities for a local/regional business based on their services and locations.

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
- Generate 20-40 keyword opportunities
- Include a mix of: service keywords, location + service combinations, question-based queries, long-tail variations
- Prioritize bottom-of-funnel (high commercial intent) keywords as "high" priority
- Include informational keywords as "medium" or "low" priority
- Group keywords into logical topic clusters (e.g., "Core Services", "Location Pages", "FAQ/Educational")
- Volume estimates should be reasonable for local/regional businesses — don't inflate
- Difficulty estimates should reflect realistic competition for a local business`,
      messages: [
        {
          role: 'user',
          content: `Generate SEO keyword opportunities for:
Business: ${clientName || 'Unknown'}
Industry: ${industry || 'Unknown'}
Services: ${Array.isArray(services) ? services.join(', ') : services || 'Not specified'}
Locations: ${Array.isArray(locations) ? locations.join(', ') : locations || 'Not specified'}`,
        },
      ],
    });

    const responseText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return NextResponse.json({ keywords: parsed, source: 'ai_suggested' });
  } catch (err: any) {
    console.error('suggest-keywords error:', err);
    return NextResponse.json({ error: err.message || 'Failed to generate keywords' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
    }

    const { clientName, existingTitles, steps } = await req.json();

    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `You are an SEO strategist at an agency. Suggest additional checklist items for a client's SEO marketing plan.

Return valid JSON only — no markdown, no commentary. The JSON must be an array of objects:
[
  {
    "stepKey": "one of the provided step keys",
    "title": "short imperative item title",
    "description": "1-2 sentence description of what to do and why",
    "priority": "high" | "medium" | "low"
  }
]

Guidelines:
- Suggest 5-10 items NOT already covered by the existing item titles
- Make items specific and actionable for an SEO agency (GSC, GA4, Ahrefs, GBP stack)
- Assign each item to the most fitting step key
- Do not duplicate or trivially rephrase existing items`,
      messages: [
        {
          role: 'user',
          content: `Client: ${clientName || 'Unknown'}
Available steps: ${JSON.stringify(steps)}
Existing item titles: ${JSON.stringify(existingTitles)}`,
        },
      ],
    });

    const responseText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return NextResponse.json({ items: parsed });
  } catch (err: any) {
    console.error('suggest-items error:', err);
    return NextResponse.json({ error: err.message ?? 'Suggestion failed' }, { status: 500 });
  }
}

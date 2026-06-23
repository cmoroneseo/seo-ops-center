import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
    }

    const context = await req.json();

    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `You are an SEO strategist writing a campaign overview for an internal SEO operations platform. Write in a professional, consultative tone — like a senior SEO director briefing an account manager.

Return valid JSON only — no markdown, no commentary. The JSON must match this shape exactly:
{
  "artExplanation": "2-3 sentences explaining how the ART framework (Authority, Relevance, Trust) applies to THIS specific client. Reference their industry, services, and goals.",
  "currentState": "2-3 sentences assessing the client's current SEO position based on available context. If limited info, note what needs to be audited.",
  "opportunities": "3-5 bullet points (as a single string with newlines) identifying specific SEO opportunities for this client based on their services, locations, and goals.",
  "challenges": "2-4 bullet points (as a single string with newlines) identifying likely challenges or obstacles.",
  "campaignObjectives": "2-3 sentences describing what this SEO campaign is designed to accomplish, tied to the client's stated goals."
}

Guidelines:
- Be specific to the client — never generic. Reference their industry, services, locations, and goals.
- Keep it SEO-focused. No paid media, social media, or email references.
- Write as if you've just reviewed the client's intake questionnaire and are preparing the internal campaign brief.
- If information is limited, say what you'd need to confirm during the audit phase.`,
      messages: [
        {
          role: 'user',
          content: `Draft the SEO Overview for this campaign:\n\n${JSON.stringify(context, null, 2)}`,
        },
      ],
    });

    const responseText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return NextResponse.json(parsed);
  } catch (err: any) {
    console.error('draft-overview error:', err);
    return NextResponse.json({ error: err.message || 'Failed to draft overview' }, { status: 500 });
  }
}

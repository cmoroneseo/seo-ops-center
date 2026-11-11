import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createSuggestKeywordsHandler } from '@/lib/campaign/suggest-keywords-route';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';

function completeWithClaude() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  return async ({ system, prompt }: { system: string; prompt: string }) => {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    return message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');
  };
}

export async function POST(req: NextRequest) {
  return createSuggestKeywordsHandler({
    requireClientOrgMember,
    complete: completeWithClaude(),
  }).POST(req);
}

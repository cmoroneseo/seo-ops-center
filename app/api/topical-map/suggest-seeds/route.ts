import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) { return cookieStore.get(name)?.value; },
                set(name: string, value: string, options: CookieOptions) { cookieStore.set({ name, value, ...options }); },
                remove(name: string, options: CookieOptions) { cookieStore.set({ name, value: '', ...options }); },
            },
        },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { type, brandName, businessDescription, existing } = await req.json();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });

    const anthropic = new Anthropic({ apiKey });
    const existingList = (existing as string[] | undefined) ?? [];
    const prompt = type === 'rivals'
        ? `Suggest 5 competitor domains for "${brandName}" (${businessDescription}). They already have: ${existingList.join(', ')}. Respond with JSON only, no markdown fencing: {"suggestions": ["domain.com", ...]}`
        : `Suggest 5 additional focus topics for "${brandName}" (${businessDescription}). They already have: ${existingList.join(', ')}. Respond with JSON only, no markdown fencing: {"suggestions": ["topic", ...]}`;

    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
        return NextResponse.json({ error: 'AI returned no text' }, { status: 500 });
    }

    try {
        const cleaned = textBlock.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const result = JSON.parse(cleaned);
        return NextResponse.json({ success: true, suggestions: result.suggestions ?? [] });
    } catch {
        return NextResponse.json({ error: 'AI returned invalid JSON' }, { status: 500 });
    }
}

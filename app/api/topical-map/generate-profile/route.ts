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

    const { clientId } = await req.json();
    if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 });

    const { data: clientRow } = await supabase
        .from('clients')
        .select('name, domain, organization_id')
        .eq('id', clientId)
        .single();

    if (!clientRow) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const { data: snapshots } = await supabase
        .from('site_page_snapshots')
        .select('requested_url, title, meta_description, h1s, word_count')
        .eq('organization_id', clientRow.organization_id)
        .eq('client_id', clientId)
        .limit(10);

    const pageContext = (snapshots ?? []).map(s =>
        `URL: ${s.requested_url}\nTitle: ${s.title ?? 'none'}\nMeta: ${s.meta_description ?? 'none'}\nH1s: ${(s.h1s as string[] ?? []).join(', ')}`
    ).join('\n\n');

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{
            role: 'user',
            content: `Based on these crawled pages from ${clientRow.domain ?? clientRow.name}, extract:
1. brand_name: the business name
2. business_description: 2-3 sentence summary of what they do
3. focus_topics: 5-10 topic seeds they should own in search

Pages:\n${pageContext}\n\nRespond with JSON only, no markdown fencing: {"brand_name": "...", "business_description": "...", "focus_topics": ["..."]}`,
        }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
        return NextResponse.json({ error: 'AI returned no text' }, { status: 500 });
    }

    try {
        const cleaned = textBlock.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const profile = JSON.parse(cleaned);
        return NextResponse.json({ success: true, profile });
    } catch {
        return NextResponse.json({ error: 'AI returned invalid JSON' }, { status: 500 });
    }
}

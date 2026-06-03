import { NextRequest, NextResponse } from 'next/server';
import { upsertIntegration, disconnectIntegration } from '@/lib/supabase/integrations';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * POST /api/integrations/ahrefs
 * Body: { clientId, orgId, apiKey }
 *
 * Ahrefs uses a simple API key (org-level).  We validate the key against
 * the Ahrefs v3 /subscription-info endpoint before storing it.
 */
export async function POST(req: NextRequest) {
    const { clientId, orgId, apiKey } = await req.json();

    if (!clientId || !orgId || !apiKey) {
        return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    }

    // Validate the key is reachable (lightweight check)
    try {
        const check = await fetch('https://api.ahrefs.com/v3/subscription-info', {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!check.ok) {
            const body = await check.json().catch(() => ({}));
            return NextResponse.json(
                { error: body?.error?.message || 'Invalid Ahrefs API key' },
                { status: 400 },
            );
        }
    } catch {
        return NextResponse.json({ error: 'Could not reach Ahrefs API' }, { status: 502 });
    }

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

    const result = await upsertIntegration({
        organizationId: orgId,
        clientId,
        service: 'ahrefs',
        credentials: { api_key: apiKey },
        connectedBy: user?.id ?? 'unknown',
    });

    if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ success: true });
}

/**
 * DELETE /api/integrations/ahrefs?clientId=...&service=ahrefs
 */
export async function DELETE(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const clientId = searchParams.get('clientId');
    const service = searchParams.get('service') as 'ga4' | 'gsc' | 'gbp' | 'ahrefs' | null;

    if (!clientId || !service) {
        return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    }

    const result = await disconnectIntegration(clientId, service);
    if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ success: true });
}

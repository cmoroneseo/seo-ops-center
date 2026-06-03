import { NextRequest, NextResponse } from 'next/server';
import { upsertIntegration } from '@/lib/supabase/integrations';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * GET /api/integrations/google/callback?code=...&state=...
 *
 * Google redirects here after the AM approves the consent screen.
 * We exchange the code for tokens and upsert into client_integrations.
 */
export async function GET(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const code = searchParams.get('code');
    const stateParam = searchParams.get('state');
    const errorParam = searchParams.get('error');

    const host = req.headers.get('x-forwarded-host') || new URL(req.url).host;
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const origin = `${protocol}://${host}`;

    if (errorParam) {
        return NextResponse.redirect(`${origin}/workspace?integrationError=${errorParam}`);
    }

    if (!code || !stateParam) {
        return NextResponse.redirect(`${origin}/workspace?integrationError=missing_params`);
    }

    // Decode state
    let state: { clientId: string; orgId: string; group: 'ga4-gsc' | 'gbp' };
    try {
        state = JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf8'));
    } catch {
        return NextResponse.redirect(`${origin}/workspace?integrationError=invalid_state`);
    }

    // Exchange code for tokens
    const clientIdEnv = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI!;

    let tokens: { access_token: string; refresh_token?: string; expiry_date?: number };
    try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: clientIdEnv,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }),
        });
        const tokenData = await tokenRes.json();
        if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);
        tokens = {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expiry_date: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
        };
    } catch (err: any) {
        console.error('Google token exchange failed:', err);
        return NextResponse.redirect(`${origin}/workspace/${state.clientId}?integrationError=token_exchange`);
    }

    // Get the current user id from the Supabase session
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
    const userId = user?.id ?? 'unknown';

    // GA4+GSC: store tokens but mark pending_setup so the property picker shows.
    // GBP: no property picker needed — the token covers all locations on the account.
    const services = state.group === 'ga4-gsc' ? ['ga4', 'gsc'] as const : ['gbp'] as const;
    const syncStatus = state.group === 'ga4-gsc' ? 'pending_setup' : 'active';

    for (const service of services) {
        await upsertIntegration({
            organizationId: state.orgId,
            clientId: state.clientId,
            service,
            credentials: tokens,
            connectedBy: userId,
            syncStatus,
        });
    }

    return NextResponse.redirect(`${origin}/workspace/${state.clientId}?integrationSuccess=${state.group}`);
}

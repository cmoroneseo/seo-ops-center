import { NextRequest, NextResponse } from 'next/server';
import { upsertIntegration } from '@/lib/supabase/integrations';
import { verifyGoogleOAuthState } from '@/lib/security/oauth-state';
import { requireClientIntegrationManager } from '@/lib/security/tenant-authz';

function getRequestOrigin(req: NextRequest) {
    const host = req.headers.get('x-forwarded-host') || new URL(req.url).host;
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    return `${protocol}://${host}`;
}

function redirectWithIntegrationError(origin: string, error: string, clientId?: string) {
    const path = clientId ? `/workspace/${clientId}` : '/workspace';
    return NextResponse.redirect(`${origin}${path}?integrationError=${encodeURIComponent(error)}`);
}

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
    const origin = getRequestOrigin(req);

    if (errorParam) {
        return redirectWithIntegrationError(origin, errorParam);
    }

    if (!code || !stateParam) {
        return redirectWithIntegrationError(origin, 'missing_params');
    }

    const state = verifyGoogleOAuthState(stateParam);
    if (!state) {
        return redirectWithIntegrationError(origin, 'invalid_state');
    }

    const authorization = await requireClientIntegrationManager(state.clientId, state.orgId);
    if (!authorization.ok) {
        return redirectWithIntegrationError(origin, 'unauthorized_integration', state.clientId);
    }

    const clientIdEnv = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientIdEnv || !clientSecret || !redirectUri) {
        return redirectWithIntegrationError(origin, 'google_oauth_not_configured', state.clientId);
    }

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
    } catch {
        return redirectWithIntegrationError(origin, 'token_exchange', state.clientId);
    }

    const services = state.group === 'ga4-gsc' ? ['ga4', 'gsc'] as const : ['gbp'] as const;
    const syncStatus = 'pending_setup';

    for (const service of services) {
        await upsertIntegration({
            organizationId: authorization.organizationId,
            clientId: authorization.clientId,
            service,
            credentials: tokens,
            connectedBy: authorization.userId,
            syncStatus,
        });
    }

    return NextResponse.redirect(`${origin}/workspace/${authorization.clientId}?integrationSuccess=${state.group}`);
}

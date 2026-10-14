import { NextRequest, NextResponse } from 'next/server';
import { googleOAuthPrompt, googleOAuthScopes, isGoogleOAuthGroup } from '@/lib/google/account';
import { requireClientIntegrationManager } from '@/lib/security/tenant-authz';
import { createGoogleOAuthState } from '@/lib/security/oauth-state';

/**
 * GET /api/integrations/google/connect?clientId=...&orgId=...&group=ga4|gsc|gbp|ga4-gsc
 *
 * Redirects the AM to Google's OAuth consent screen. The `group` param controls
 * which scopes are requested: 'ga4-gsc' covers GA4 + GSC in a single auth,
 * 'gbp' covers Google Business Profile separately.
 */
export async function GET(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const clientId = searchParams.get('clientId');
    const orgId = searchParams.get('orgId');
    const group = searchParams.get('group');

    const authorization = await requireClientIntegrationManager(clientId, orgId);
    if (!authorization.ok) {
        return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    if (!isGoogleOAuthGroup(group)) {
        return NextResponse.json({ error: 'Missing or invalid params' }, { status: 400 });
    }

    const scopes = googleOAuthScopes(group);

    const clientIdEnv = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientIdEnv || !redirectUri) {
        return NextResponse.json(
            { error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI.' },
            { status: 500 },
        );
    }

    const state = createGoogleOAuthState({
        clientId: authorization.clientId,
        orgId: authorization.organizationId,
        group,
    });

    const params = new URLSearchParams({
        client_id: clientIdEnv,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        access_type: 'offline',   // request refresh_token
        prompt: googleOAuthPrompt(),
        state,
    });

    return NextResponse.redirect(
        `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    );
}

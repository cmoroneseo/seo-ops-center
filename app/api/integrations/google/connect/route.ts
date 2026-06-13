import { NextRequest, NextResponse } from 'next/server';
import { requireClientIntegrationManager } from '@/lib/security/tenant-authz';
import { createGoogleOAuthState } from '@/lib/security/oauth-state';

// Scopes for each service group
const SCOPES: Record<string, string[]> = {
    'ga4-gsc': [
        'https://www.googleapis.com/auth/analytics.readonly',
        'https://www.googleapis.com/auth/webmasters.readonly',
    ],
    'gbp': [
        'https://www.googleapis.com/auth/business.manage',
    ],
};

/**
 * GET /api/integrations/google/connect?clientId=...&orgId=...&group=ga4-gsc|gbp
 *
 * Redirects the AM to Google's OAuth consent screen. The `group` param controls
 * which scopes are requested: 'ga4-gsc' covers GA4 + GSC in a single auth,
 * 'gbp' covers Google Business Profile separately.
 */
export async function GET(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const clientId = searchParams.get('clientId');
    const orgId = searchParams.get('orgId');
    const group = searchParams.get('group') as 'ga4-gsc' | 'gbp' | null;

    if (!clientId || !orgId || !group || !SCOPES[group]) {
        return NextResponse.json({ error: 'Missing or invalid params' }, { status: 400 });
    }

    const authorization = await requireClientIntegrationManager(clientId, orgId);
    if (!authorization.ok) {
        return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

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
        scope: SCOPES[group].join(' '),
        access_type: 'offline',   // request refresh_token
        prompt: 'consent',         // always show consent so we get a refresh_token
        state,
    });

    return NextResponse.redirect(
        `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    );
}

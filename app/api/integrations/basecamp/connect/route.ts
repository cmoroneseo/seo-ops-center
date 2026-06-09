import { NextResponse } from 'next/server';

/**
 * GET /api/integrations/basecamp/connect
 * Redirects to Basecamp OAuth authorization page.
 * Visit this URL in your browser to start the one-time authorization flow.
 */
export async function GET() {
    const clientId = process.env.BASECAMP_CLIENT_ID;
    if (!clientId) {
        return NextResponse.json(
            { error: 'BASECAMP_CLIENT_ID is not set in your environment variables.' },
            { status: 500 },
        );
    }

    const redirectUri = process.env.BASECAMP_REDIRECT_URI ?? 'http://localhost:3000/api/integrations/basecamp/callback';

    const authUrl = new URL('https://launchpad.37signals.com/authorization/new');
    authUrl.searchParams.set('type', 'web_server');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);

    return NextResponse.redirect(authUrl.toString());
}

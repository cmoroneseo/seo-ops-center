import { randomBytes } from 'node:crypto';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
    createBasecampOAuthHandlers,
    createBasecampOAuthState,
} from '@/lib/basecamp/oauth-route';

const STATE_COOKIE = 'basecamp_oauth_state';

async function getUserId() {
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
    return user?.id ?? null;
}

function getConfiguration() {
    const clientId = process.env.BASECAMP_CLIENT_ID;
    const clientSecret = process.env.BASECAMP_CLIENT_SECRET;
    const redirectUri = process.env.BASECAMP_REDIRECT_URI;
    return clientId && clientSecret && redirectUri
        ? { clientId, clientSecret, redirectUri }
        : null;
}

/** Authenticated, state-bound start of the operator-managed Basecamp OAuth flow. */
export async function GET(req: Request) {
    const handlers = createBasecampOAuthHandlers({
        getUserId,
        issueState(userId, returnTo) {
            const secret = process.env.BASECAMP_OAUTH_STATE_SECRET || process.env.BASECAMP_CLIENT_SECRET;
            if (!secret) throw new Error('Missing Basecamp OAuth state secret');
            return createBasecampOAuthState({
                userId,
                returnTo,
                nowSeconds: Math.floor(Date.now() / 1000),
                nonce: randomBytes(32).toString('base64url'),
                secret,
            });
        },
        async setStateCookie(state) {
            const cookieStore = await cookies();
            cookieStore.set(STATE_COOKIE, state, {
                httpOnly: true,
                sameSite: 'lax',
                secure: process.env.NODE_ENV === 'production',
                path: '/api/integrations/basecamp',
                maxAge: 10 * 60,
            });
        },
        consumeStateCookie: async () => null,
        verifyState: () => null,
        getConfiguration,
        exchangeCode: async () => { throw new Error('not used by connect'); },
    });
    return handlers.connect(req);
}

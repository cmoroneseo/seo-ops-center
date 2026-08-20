import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
    createBasecampOAuthHandlers,
    hashBasecampOAuthState,
    verifyBasecampOAuthState,
} from '@/lib/basecamp/oauth-route';
import { createAdminClient } from '@/lib/supabase/admin';

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

/**
 * State-bound callback. This deployment keeps Basecamp credentials in operator-
 * managed environment variables, so exchanged tokens are never rendered or
 * persisted by the application.
 */
export async function GET(req: Request) {
    const handlers = createBasecampOAuthHandlers({
        getUserId,
        issueState: () => { throw new Error('not used by callback'); },
        persistState: async () => false,
        setStateCookie: async () => {},
        async consumeStateCookie() {
            const cookieStore = await cookies();
            const value = cookieStore.get(STATE_COOKIE)?.value ?? null;
            cookieStore.set(STATE_COOKIE, '', {
                httpOnly: true,
                sameSite: 'lax',
                secure: process.env.NODE_ENV === 'production',
                path: '/api/integrations/basecamp',
                maxAge: 0,
            });
            return value;
        },
        verifyState(state) {
            const secret = process.env.BASECAMP_OAUTH_STATE_SECRET || process.env.BASECAMP_CLIENT_SECRET;
            return secret
                ? verifyBasecampOAuthState(state, secret, Math.floor(Date.now() / 1000))
                : null;
        },
        async consumePersistedState(state, userId) {
            const now = new Date().toISOString();
            const { data, error } = await createAdminClient()
                .from('basecamp_oauth_states')
                .update({ consumed_at: now })
                .eq('state_hash', hashBasecampOAuthState(state))
                .eq('user_id', userId)
                .is('consumed_at', null)
                .gt('expires_at', now)
                .select('state_hash')
                .maybeSingle();
            return !error && Boolean(data);
        },
        getConfiguration,
        async exchangeCode(code, configuration) {
            const response = await fetch('https://launchpad.37signals.com/authorization/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    type: 'web_server',
                    client_id: configuration.clientId,
                    client_secret: configuration.clientSecret,
                    redirect_uri: configuration.redirectUri,
                    code,
                }),
            });
            if (!response.ok) throw new Error('Basecamp token exchange failed');
            const tokens = await response.json() as Record<string, unknown>;
            if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') {
                throw new Error('Basecamp token response was incomplete');
            }
            return {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
            };
        },
    });
    return handlers.callback(req);
}

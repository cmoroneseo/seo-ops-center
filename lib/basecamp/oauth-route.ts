import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface BasecampOAuthState {
    userId: string;
    returnTo: string;
    nonce: string;
    exp: number;
}

interface OAuthConfiguration {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

interface Dependencies {
    getUserId(): Promise<string | null>;
    issueState(userId: string, returnTo: string): string;
    persistState(state: string): Promise<boolean>;
    setStateCookie(state: string): Promise<void>;
    consumeStateCookie(): Promise<string | null>;
    verifyState(state: string): BasecampOAuthState | null;
    consumePersistedState(state: string, userId: string): Promise<boolean>;
    getConfiguration(): OAuthConfiguration | null;
    exchangeCode(
        code: string,
        configuration: OAuthConfiguration,
    ): Promise<{ accessToken: string; refreshToken: string }>;
}

const STATE_TTL_SECONDS = 10 * 60;

function safeReturnTo(value: string) {
    if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
        throw new Error('Unsafe OAuth return destination');
    }
    return value;
}

function encode(value: string) {
    return Buffer.from(value, 'utf8').toString('base64url');
}

function sign(payload: string, secret: string) {
    return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function hashBasecampOAuthState(state: string) {
    return createHash('sha256').update(state, 'utf8').digest('hex');
}

export function createBasecampOAuthState(input: {
    userId: string;
    returnTo: string;
    nowSeconds: number;
    nonce: string;
    secret: string;
}) {
    if (!input.userId || !input.nonce || !input.secret) throw new Error('Invalid OAuth state input');
    const state: BasecampOAuthState = {
        userId: input.userId,
        returnTo: safeReturnTo(input.returnTo),
        nonce: input.nonce,
        exp: input.nowSeconds + STATE_TTL_SECONDS,
    };
    const payload = encode(JSON.stringify(state));
    return `${payload}.${sign(payload, input.secret)}`;
}

export function verifyBasecampOAuthState(
    stateParam: string,
    secret: string,
    nowSeconds: number,
): BasecampOAuthState | null {
    const [payload, signature, extra] = stateParam.split('.');
    if (!payload || !signature || extra || !secret) return null;
    const expected = Buffer.from(sign(payload, secret));
    const received = Buffer.from(signature);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

    let value: unknown;
    try {
        value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
    if (!value || typeof value !== 'object') return null;
    const state = value as Record<string, unknown>;
    if (typeof state.userId !== 'string' || !state.userId) return null;
    if (typeof state.nonce !== 'string' || !state.nonce) return null;
    if (typeof state.returnTo !== 'string') return null;
    try {
        safeReturnTo(state.returnTo);
    } catch {
        return null;
    }
    if (typeof state.exp !== 'number' || state.exp < nowSeconds) return null;
    return state as unknown as BasecampOAuthState;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

export function createBasecampOAuthHandlers(dependencies: Dependencies) {
    return {
        async connect(req: Request): Promise<Response> {
            const userId = await dependencies.getUserId();
            if (!userId) return json({ error: 'Unauthorized' }, 401);

            const configuration = dependencies.getConfiguration();
            if (!configuration) return json({ error: 'Basecamp OAuth not configured' }, 500);

            const requestedReturnTo = new URL(req.url).searchParams.get('returnTo') || '/settings';
            let state: string;
            try {
                state = dependencies.issueState(userId, requestedReturnTo);
            } catch {
                return json({ error: 'Invalid return destination' }, 400);
            }
            if (!await dependencies.persistState(state)) {
                return json({ error: 'Unable to persist OAuth state' }, 500);
            }
            await dependencies.setStateCookie(state);

            const authUrl = new URL('https://launchpad.37signals.com/authorization/new');
            authUrl.searchParams.set('type', 'web_server');
            authUrl.searchParams.set('client_id', configuration.clientId);
            authUrl.searchParams.set('redirect_uri', configuration.redirectUri);
            authUrl.searchParams.set('state', state);
            return Response.redirect(authUrl);
        },

        async callback(req: Request): Promise<Response> {
            const userId = await dependencies.getUserId();
            if (!userId) return json({ error: 'Unauthorized' }, 401);

            const params = new URL(req.url).searchParams;
            const code = params.get('code');
            const stateParam = params.get('state');
            if (!code || !stateParam) return json({ error: 'Missing OAuth callback parameters' }, 400);

            const cookieState = await dependencies.consumeStateCookie();
            const state = dependencies.verifyState(stateParam);
            if (!cookieState || cookieState !== stateParam || !state) {
                return json({ error: 'Invalid or replayed OAuth state' }, 400);
            }
            if (state.userId !== userId) return json({ error: 'Forbidden' }, 403);
            if (!await dependencies.consumePersistedState(stateParam, userId)) {
                return json({ error: 'Invalid or replayed OAuth state' }, 400);
            }

            const configuration = dependencies.getConfiguration();
            if (!configuration) return json({ error: 'Basecamp OAuth not configured' }, 500);

            try {
                await dependencies.exchangeCode(code, configuration);
            } catch {
                return json({ error: 'Basecamp token exchange failed' }, 502);
            }

            return json({
                error: 'Basecamp credentials require secure operator provisioning; tokens were not displayed or persisted.',
                returnTo: state.returnTo,
            }, 503);
        },
    };
}

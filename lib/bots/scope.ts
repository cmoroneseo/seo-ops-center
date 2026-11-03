/** Bearer tokens minted for SEO bots. Not a Supabase key. */
export const BOT_KEY_PREFIX = 'seo_bot_';

export const BOT_TIME_PATH = '/api/bots/time';

export function bearerToken(authorization: string | null | undefined): string | null {
    if (!authorization) return null;
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    return match?.[1] ?? null;
}

export function isBotKeyToken(token: string | null | undefined): boolean {
    return Boolean(token && token.startsWith(BOT_KEY_PREFIX) && token.length > BOT_KEY_PREFIX.length);
}

/**
 * A bot key is allowed to POST the time entry route and nothing else.
 * Missing or non-bot credentials are ignored so session and cron auth keep working.
 */
export function botRequestDecision(input: {
    pathname: string;
    method: string;
    authorization: string | null | undefined;
}): 'allow' | 'forbid' | 'ignore' {
    if (!isBotKeyToken(bearerToken(input.authorization))) return 'ignore';
    if (input.pathname === BOT_TIME_PATH && input.method.toUpperCase() === 'POST') return 'allow';
    return 'forbid';
}

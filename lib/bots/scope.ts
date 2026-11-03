/** Bearer tokens minted for SEO bots. Not a Supabase key. */
export const BOT_KEY_PREFIX = 'seo_bot_';

export const BOT_TASKS_PATH = '/api/bots/tasks';
export const BOT_TIMER_START_PATH = '/api/bots/timer/start';
export const BOT_TIMER_STOP_PATH = '/api/bots/timer/stop';

const BOT_POST_PATHS = new Set([
    BOT_TASKS_PATH,
    BOT_TIMER_START_PATH,
    BOT_TIMER_STOP_PATH,
]);

export function bearerToken(authorization: string | null | undefined): string | null {
    if (!authorization) return null;
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    return match?.[1] ?? null;
}

export function isBotKeyToken(token: string | null | undefined): boolean {
    return Boolean(token && token.startsWith(BOT_KEY_PREFIX) && token.length > BOT_KEY_PREFIX.length);
}

/**
 * A bot key may POST task create and the timer start/stop routes, and nothing else.
 * Missing or non-bot credentials are ignored so session and cron auth keep working.
 */
export function botRequestDecision(input: {
    pathname: string;
    method: string;
    authorization: string | null | undefined;
}): 'allow' | 'forbid' | 'ignore' {
    if (!isBotKeyToken(bearerToken(input.authorization))) return 'ignore';
    if (input.method.toUpperCase() === 'POST' && BOT_POST_PATHS.has(input.pathname)) return 'allow';
    return 'forbid';
}

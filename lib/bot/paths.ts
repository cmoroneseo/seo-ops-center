/** Sessionless read API. Middleware must not redirect these to the login page. */
export function isBotApiPath(pathname: string): boolean {
    return pathname === '/api/bot/ga4' || pathname === '/api/bot/gsc';
}

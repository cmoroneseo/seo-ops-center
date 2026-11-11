import { normalizeGa4LandingPage } from '@/lib/ga4/sync';
import { normalizeResultUrl } from '@/lib/search-reporting/result-url';

/** A logged URL with no query does not claim a different query-string row, such as a GBP tag. */
export function pageMatchesChange(factPage: string, loggedUrl: string): boolean {
    const factKey = normalizeResultUrl(factPage);
    const loggedKey = normalizeResultUrl(loggedUrl);
    if (!factKey || factKey !== loggedKey) return false;
    let fact: URL;
    let logged: URL;
    try {
        fact = new URL(factPage);
        logged = new URL(loggedUrl);
    } catch {
        return false;
    }
    if (logged.search === '' && fact.search !== '') return false;
    return true;
}

export function ga4PathFor(url: string): string | null {
    try {
        const parsed = new URL(url);
        return normalizeGa4LandingPage(parsed.pathname || '/');
    } catch {
        return null;
    }
}

/** URL strings Search Console may have stored for one logged page. */
export function gscPageCandidates(raw: string): string[] {
    const key = normalizeResultUrl(raw);
    if (!key) return [];
    const slash = key.indexOf('/');
    const host = slash === -1 ? key : key.slice(0, slash);
    const path = slash === -1 ? '/' : key.slice(slash);
    const hosts = host.startsWith('www.') ? [host, host.slice(4)] : [host, `www.${host}`];
    const paths = path === '/' ? ['/'] : [path, `${path}/`];
    const urls = new Set<string>();
    const trimmed = raw.trim();
    if (trimmed) urls.add(trimmed);
    for (const name of hosts) {
        for (const body of paths) {
            urls.add(`https://${name}${body}`);
            urls.add(`http://${name}${body}`);
        }
    }
    return [...urls];
}

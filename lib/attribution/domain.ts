/** Parse user-entered URLs/hosts into the canonical hostname stored for a site. */
export function normalizeDomain(value: string): string | null {
    try {
        const input = value.trim();
        if (!input || /\s/.test(input)) return null;
        const url = new URL(input.includes('://') ? input : `https://${input}`);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        const hostname = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
        if (hostname.length > 253 || !hostname.includes('.') || /^\d+(\.\d+){3}$/.test(hostname)) return null;
        if (!hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
        return hostname;
    } catch {
        return null;
    }
}

export function matchesSiteDomain(hostname: string, siteDomain: string): boolean {
    const host = normalizeDomain(hostname);
    const site = normalizeDomain(siteDomain);
    return Boolean(host && site && (host === site || host.endsWith(`.${site}`)));
}

/** GSC domain properties include subdomains; URL-prefix properties retain their exact prefix. */
export function pageBelongsToProperty(page: string, property: string): boolean {
    try {
        const url = new URL(page);
        if (!['http:', 'https:'].includes(url.protocol)) return false;
        if (property.startsWith('sc-domain:')) {
            const domain = property.slice(10).toLowerCase();
            return url.hostname === domain || url.hostname.endsWith(`.${domain}`);
        }
        const prefix = new URL(property);
        return ['http:', 'https:'].includes(prefix.protocol) &&
            url.origin === prefix.origin && url.pathname.startsWith(prefix.pathname);
    } catch {
        return false;
    }
}

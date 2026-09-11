export interface SiteScope {
    seedUrl: string;
    configuredHost: string;
    allowedHosts: string[];
}

function parseAbsoluteHttpUrl(input: string) {
    if (typeof input !== 'string' || input.trim().length === 0) {
        throw new Error('Site URL must be an absolute HTTP URL');
    }
    let parsed: URL;
    try {
        parsed = new URL(input.trim());
    } catch {
        throw new Error('Site URL must be an absolute HTTP URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Site URL must use HTTP or HTTPS');
    }
    if (parsed.username || parsed.password) {
        throw new Error('Site URL must not contain credentials');
    }
    if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
        throw new Error('Site URL uses a disallowed port');
    }
    if (!parsed.hostname) throw new Error('Site URL must include a host');
    return parsed;
}

export function normalizeSiteUrl(input: string) {
    const parsed = parseAbsoluteHttpUrl(input);
    parsed.hash = '';
    return parsed.toString();
}

export function configuredSiteScope(input: string): SiteScope {
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
    const seedUrl = normalizeSiteUrl(candidate);
    const configuredHost = new URL(seedUrl).hostname.toLowerCase();
    const allowedHosts = configuredHost.startsWith('www.')
        ? [configuredHost.slice(4), configuredHost]
        : configuredHost.split('.').length === 2
            ? [configuredHost, `www.${configuredHost}`]
            : [configuredHost];
    return { seedUrl, configuredHost, allowedHosts: [...new Set(allowedHosts)].sort() };
}

export function isUrlInSiteScope(input: string, scope: SiteScope) {
    try {
        const url = new URL(normalizeSiteUrl(input));
        return scope.allowedHosts.includes(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}

export interface SiteScope {
    seedUrl: string;
    configuredHost: string;
    allowedHosts: string[];
}

const NON_PAGE_ASSET_EXTENSION = /\.(?:avif|bmp|css|eot|gif|ico|jpe?g|js|m4a|m4v|map|mov|mp3|mp4|mpeg|oga|ogg|ogv|otf|png|rar|svg|tar|tif?f|ttf|wav|webm|webp|woff2?|zip)$/i;

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

export function isKnownNonPageAssetUrl(input: string) {
    try {
        const pathname = decodeURIComponent(parseAbsoluteHttpUrl(input).pathname);
        return NON_PAGE_ASSET_EXTENSION.test(pathname);
    } catch {
        return false;
    }
}

export function configuredSiteScope(input: string): SiteScope {
    const trimmed = input.trim();
    const gscDomain = trimmed.toLowerCase().startsWith('sc-domain:')
        ? trimmed.slice('sc-domain:'.length).trim()
        : undefined;
    if (gscDomain !== undefined && (!gscDomain || !/^[a-z\d.-]+$/i.test(gscDomain))) {
        throw new Error('GSC domain property must contain only a host');
    }
    const site = gscDomain ?? trimmed;
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(site) ? site : `https://${site}`;
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

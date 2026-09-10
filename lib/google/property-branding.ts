import type { GscSite } from './gsc-properties';

export interface PropertyBrand {
    domain?: string | null;
    savedProperty?: string | null;
    logoUrl?: string | null;
}

/** Match hosts, never display names or arbitrary parent-domain suffixes. */
export function propertyHost(value?: string | null): string | null {
    if (!value) return null;
    try {
        const input = value.startsWith('sc-domain:') ? value.slice(10) : value;
        const url = new URL(input.includes('://') ? input : `https://${input}`);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
        return url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    } catch { return null; }
}

export function propertyFavicon(siteUrl: string): string | undefined {
    const host = propertyHost(siteUrl);
    // Only send a public hostname to the favicon service, never paths or credentials.
    if (!host || !host.includes('.') || /[:\[\]]/.test(host) || /^\d+(\.\d+){3}$/.test(host)
        || /\.(localhost|local|internal|test|invalid)$/.test(host)) return undefined;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

export function withPropertyLogos(sites: GscSite[], brands: PropertyBrand[]): GscSite[] {
    return sites.map(site => {
        const host = propertyHost(site.siteUrl);
        const matches = brands.filter(brand => host && propertyHost(brand.domain || brand.savedProperty) === host);
        const logos = [...new Set(matches.map(brand => brand.logoUrl).filter((url): url is string => {
            if (!url) return false;
            try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password; }
            catch { return false; }
        }))];
        // Ambiguous client branding should fall back to the site's favicon.
        return { ...site, logoUrl: logos.length === 1 ? logos[0] : undefined };
    });
}

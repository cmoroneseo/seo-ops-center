const DEFAULT_COLLECTOR_ORIGIN = 'https://seo-ops-center.vercel.app';

function canonicalOrigin(value: string): string | null {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        return url.origin;
    } catch {
        return null;
    }
}

export function trackingScriptOrigin(browserOrigin: string, configuredOrigin = process.env.NEXT_PUBLIC_APP_URL): string {
    const browser = canonicalOrigin(browserOrigin);
    if (browser) {
        const hostname = new URL(browser).hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1') return browser;
    }
    return canonicalOrigin(configuredOrigin ?? '') ?? DEFAULT_COLLECTOR_ORIGIN;
}

export function buildTrackingSnippet(origin: string, siteId: string, trackTelClicks: boolean): string {
    return `<script defer src="${origin}/api/attribution/s.js" data-site="${siteId}" data-track-tel="${trackTelClicks}"></script>`;
}

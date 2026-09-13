import type { SourceCategory } from '@/lib/types';
import { normalizeDomain } from './domain';

export type { SourceCategory };

export const SOURCE_CATEGORIES: readonly SourceCategory[] = [
    'organic_google', 'organic_bing', 'organic_other', 'ai_chatgpt',
    'ai_perplexity', 'ai_google_aio', 'social', 'paid', 'direct', 'referral', 'same_site',
];

export function isSourceCategory(value: unknown): value is SourceCategory {
    return typeof value === 'string' && SOURCE_CATEGORIES.includes(value as SourceCategory);
}

const SEO_SOURCES = new Set<SourceCategory>([
    'organic_google', 'organic_bing', 'organic_other', 'ai_chatgpt', 'ai_perplexity', 'ai_google_aio',
]);

export function isSeoSource(value: string): boolean {
    return isSourceCategory(value) && SEO_SOURCES.has(value);
}

export function countSeoConversions(sources: { sourceCategory: string; count: number }[]): number {
    return sources.reduce((total, source) => total + (isSeoSource(source.sourceCategory) ? source.count : 0), 0);
}

const SOCIAL_DOMAINS = [
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    'twitter.com',
    'x.com',
    'tiktok.com',
    'youtube.com',
    'pinterest.com',
    'reddit.com',
    'threads.net',
];

const OTHER_SEARCH_ENGINES = [
    'yahoo.com',
    'search.yahoo.com',
    'duckduckgo.com',
    'ecosia.org',
    'baidu.com',
    'yandex.com',
    'yandex.ru',
];

const PAID_UTM_MEDIUMS = ['cpc', 'ppc'];

function extractDomain(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

function matchesDomain(domain: string, target: string): boolean {
    return domain === target || domain.endsWith('.' + target);
}

export function classifySource(
    referrer: string,
    utmMedium: string | null,
    siteDomain: string,
): SourceCategory {
    if (utmMedium && PAID_UTM_MEDIUMS.includes(utmMedium.toLowerCase())) return 'paid';

    if (!referrer) return 'direct';

    const domain = extractDomain(referrer);
    if (!domain) return 'direct';

    const normalizedSite = normalizeDomain(siteDomain) ?? siteDomain;
    if (matchesDomain(domain, normalizedSite)) return 'same_site';

    if (domain === 'chatgpt.com' || domain === 'chat.openai.com') return 'ai_chatgpt';
    if (matchesDomain(domain, 'perplexity.ai')) return 'ai_perplexity';

    if (/^google\./i.test(domain) || /\.google\./i.test(domain) || /\.google$/i.test(domain)) {
        return 'organic_google';
    }
    if (matchesDomain(domain, 'bing.com')) return 'organic_bing';

    if (OTHER_SEARCH_ENGINES.some((se) => matchesDomain(domain, se))) return 'organic_other';

    if (SOCIAL_DOMAINS.some((sd) => matchesDomain(domain, sd))) return 'social';

    return 'referral';
}

/** Classify first-touch inputs on the server; never persist an arbitrary browser category. */
export function resolveSessionAttribution(event: Record<string, unknown>, siteDomain: string) {
    const text = (value: unknown) => typeof value === 'string' ? value : '';
    const hasFirstTouch = typeof event.initial_referrer === 'string';
    const utmSource = text(hasFirstTouch ? event.initial_utm_source : event.utm_source);
    const utmMedium = text(hasFirstTouch ? event.initial_utm_medium : event.utm_medium);
    const utmCampaign = text(hasFirstTouch ? event.initial_utm_campaign : event.utm_campaign);
    let referrer = text(hasFirstTouch ? event.initial_referrer : event.referrer);
    let sourceCategory = classifySource(referrer, utmMedium, siteDomain);
    // Compatibility with already-cached v1 scripts, which called their raw
    // initial referrer session_source. V2 always sends explicit initial inputs.
    if (!hasFirstTouch && sourceCategory === 'same_site') {
        const previous = event.session_source;
        if (isSourceCategory(previous)) sourceCategory = previous;
        else {
            referrer = text(previous);
            sourceCategory = classifySource(referrer, utmMedium, siteDomain);
        }
    }
    if (sourceCategory === 'same_site') sourceCategory = 'direct';
    return { sourceCategory, referrer, utmSource, utmMedium, utmCampaign };
}

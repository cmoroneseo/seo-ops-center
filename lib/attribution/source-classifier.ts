import type { SourceCategory } from '@/lib/types';

export type { SourceCategory };

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

    const normalizedSite = siteDomain.replace(/^www\./, '');
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

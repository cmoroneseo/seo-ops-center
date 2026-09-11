import * as cheerio from 'cheerio';

export interface ExtractedLink {
    url: string;
    anchorText: string;
    nofollow: boolean;
}

export interface HtmlEvidence {
    title?: string;
    metaDescription?: string;
    canonicalUrl?: string;
    robotsDirectives: string[];
    h1s: string[];
    wordCount: number;
    links: ExtractedLink[];
}

function cleanText(value: string | undefined) {
    const cleaned = value?.replace(/\s+/g, ' ').trim();
    return cleaned || undefined;
}

function absoluteHttpUrl(value: string | undefined, baseUrl: string) {
    if (!value) return undefined;
    try {
        const url = new URL(value, baseUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
        url.hash = '';
        return url.toString();
    } catch {
        return undefined;
    }
}

export function extractHtmlEvidence(html: string, responseUrl: string): HtmlEvidence {
    const $ = cheerio.load(html);
    const baseCandidate = absoluteHttpUrl($('base[href]').first().attr('href'), responseUrl);
    const baseUrl = baseCandidate ?? responseUrl;
    const title = cleanText($('title').first().text());
    const metaDescription = cleanText($('meta[name="description" i]').first().attr('content'));
    const canonicalUrl = absoluteHttpUrl($('link[rel~="canonical" i]').first().attr('href'), baseUrl);
    const robotsDirectives = ($('meta[name="robots" i]').first().attr('content') ?? '')
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean);
    const h1s = $('h1').toArray().map(element => cleanText($(element).text())).filter((value): value is string => Boolean(value));

    $('script,style,noscript,template,svg').remove();
    const bodyText = cleanText($('body').text()) ?? '';
    const wordCount = bodyText ? bodyText.split(/\s+/u).filter(Boolean).length : 0;
    const links: ExtractedLink[] = [];
    $('a[href]').each((_index, element) => {
        const raw = $(element).attr('href')?.trim();
        if (!raw || raw.startsWith('#')) return;
        const url = absoluteHttpUrl(raw, baseUrl);
        if (!url) return;
        const rel = ($(element).attr('rel') ?? '').toLowerCase().split(/\s+/);
        links.push({
            url,
            anchorText: cleanText($(element).text()) ?? '',
            nofollow: rel.includes('nofollow'),
        });
    });

    return { title, metaDescription, canonicalUrl, robotsDirectives, h1s, wordCount, links };
}

export function extractSitemapLocations(xml: string) {
    const $ = cheerio.load(xml, { xmlMode: true });
    return $('loc').toArray().map(element => cleanText($(element).text())).filter((value): value is string => Boolean(value));
}

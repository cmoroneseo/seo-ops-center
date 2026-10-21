import { isPlanMonth } from './plan-sections';

/** The month the overview and the SEO Plan share. Invalid values are ignored. */
export function readOverviewMonth(search: string): string | null {
    const value = new URLSearchParams(search).get('overviewMonth');
    return value && isPlanMonth(value) ? value : null;
}

/** Replace overviewMonth and keep the rest of the query. */
export function hrefWithOverviewMonth(href: string, month: string): string {
    const url = new URL(href, 'https://seo-ops-center.local');
    url.searchParams.set('overviewMonth', month);
    return `${url.pathname}${url.search}${url.hash}`;
}

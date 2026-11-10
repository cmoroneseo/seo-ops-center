/**
 * Opportunities sub-views on the client workspace.
 *
 * Performance is the Search dashboard (`?tab=insights`, and `?tab=search`).
 * Backlog keeps the GSC candidates. Rankings and Site health keep their
 * existing tabs so the current sidebar links still land on that content.
 * Rankings is included only when keyword tracking is exactly on.
 */

export const OPPORTUNITY_VIEWS = ['performance', 'backlog', 'rankings', 'health'] as const;
export type OpportunityView = (typeof OPPORTUNITY_VIEWS)[number];

export const OPPORTUNITY_RANGES = [7, 28, 90] as const;
export type OpportunityRange = (typeof OPPORTUNITY_RANGES)[number];

export type OpportunityTab = 'insights' | 'inventory' | 'rankings';

export interface OpportunityRoute {
    /** Null when this query is not an Opportunities destination. */
    tab: OpportunityTab | null;
    view: OpportunityView;
    /** Canonical query, including `?`, when the current one should be rewritten. */
    rewrite: string | null;
}

const ROLLING_RANGES = new Set(['7d', '28d', '90d']);

export function opportunityViews(keywordTracking: boolean): { id: OpportunityView; label: string }[] {
    const views: { id: OpportunityView; label: string }[] = [
        { id: 'performance', label: 'Performance' },
        { id: 'backlog', label: 'Backlog' },
    ];
    if (keywordTracking) views.push({ id: 'rankings', label: 'Rankings' });
    views.push({ id: 'health', label: 'Site health' });
    return views;
}

export function parseOpportunityRange(value: string | null | undefined): OpportunityRange {
    if (value === '7d') return 7;
    if (value === '90d') return 90;
    return 28;
}

/** Month keys stay on the ledger. Rolling 7/90 are the performance window. */
export function opportunityMonthRange(value: string | null | undefined): string | null {
    if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
    return null;
}

function paramsFrom(search: string): URLSearchParams {
    const raw = search.startsWith('?') ? search.slice(1) : search;
    return new URLSearchParams(raw);
}

function canonical(params: URLSearchParams): string {
    const text = params.toString();
    return text ? `?${text}` : '';
}

function route(
    original: URLSearchParams,
    params: URLSearchParams,
    tab: OpportunityTab,
    view: OpportunityView,
): OpportunityRoute {
    const next = canonical(params);
    return { tab, view, rewrite: next === canonical(original) ? null : next };
}

export function readOpportunityRoute(
    search: string,
    options: { keywordTracking: boolean },
): OpportunityRoute {
    const original = paramsFrom(search);
    const params = paramsFrom(search);
    const tab = original.get('tab');
    const requested = original.get('view');

    if (tab === 'inventory') {
        params.delete('view');
        return route(original, params, 'inventory', 'health');
    }

    if (tab === 'rankings') {
        if (!options.keywordTracking) return { tab: null, view: 'performance', rewrite: null };
        params.delete('view');
        return route(original, params, 'rankings', 'rankings');
    }

    if (tab !== 'insights' && tab !== 'search') {
        return { tab: null, view: 'performance', rewrite: null };
    }

    params.set('tab', 'insights');
    if (requested === 'backlog') {
        params.set('view', 'backlog');
        return route(original, params, 'insights', 'backlog');
    }
    if (requested === 'health' || requested === 'site-health') {
        params.set('tab', 'inventory');
        params.delete('view');
        return route(original, params, 'inventory', 'health');
    }
    if (requested === 'rankings') {
        if (!options.keywordTracking) {
            params.delete('view');
            return route(original, params, 'insights', 'performance');
        }
        params.set('tab', 'rankings');
        params.delete('view');
        return route(original, params, 'rankings', 'rankings');
    }
    params.delete('view');
    return route(original, params, 'insights', 'performance');
}

export function withOpportunityView(
    search: string,
    view: OpportunityView,
    options: { keywordTracking: boolean },
): string {
    const params = paramsFrom(search);
    params.delete('navNotice');
    params.delete('planView');
    params.delete('campaignView');
    if (view === 'backlog') {
        params.set('tab', 'insights');
        params.set('view', 'backlog');
    } else if (view === 'health') {
        params.set('tab', 'inventory');
        params.delete('view');
    } else if (view === 'rankings' && options.keywordTracking) {
        params.set('tab', 'rankings');
        params.delete('view');
    } else {
        params.set('tab', 'insights');
        params.delete('view');
    }
    return canonical(params) || '?tab=insights';
}

export function withOpportunityRange(search: string, days: OpportunityRange): string {
    const params = paramsFrom(search);
    if (days === 28) {
        const current = params.get('range');
        if (current != null && ROLLING_RANGES.has(current)) params.delete('range');
    } else {
        params.set('range', `${days}d`);
    }
    return canonical(params);
}

export function freshnessValue(value: unknown): string {
    if (typeof value !== 'string') return '—';
    const trimmed = value.trim();
    return trimmed || '—';
}

import { STATES_COPY } from '@/lib/reporting/states-copy';
import { CLUSTER_IMPRESSION_MINIMUM, TOO_FEW_SEARCHES } from './types';
import type { CityRow, ReportingSurface } from './types';

export interface CityQuery {
    query: string;
    surface: ReportingSurface;
    current: number;
    prior: number;
}

export function normalizeQuery(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Longest city token wins, matched on word boundaries. */
export function matchCity(query: string, tokens: readonly string[]): string | null {
    const haystack = ` ${normalizeQuery(query).replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;
    const ordered = [...new Set(tokens.map(token => token.trim().toLowerCase()).filter(token => token.length >= 3))];
    ordered.sort((a, b) => b.length - a.length || a.localeCompare(b));
    for (const token of ordered) {
        if (haystack.includes(` ${token} `)) return token;
    }
    return null;
}

export function buildCityRows(queries: CityQuery[], tokens: readonly string[], surface: 'all' | 'organic' | 'map'): CityRow[] {
    const groups = new Map<string, { city: string; surface: ReportingSurface; current: number; prior: number }>();
    for (const row of queries) {
        if (surface === 'organic' && row.surface !== 'organic') continue;
        if (surface === 'map' && row.surface !== 'gbp_link') continue;
        const city = matchCity(row.query, tokens);
        if (!city) continue;
        const key = `${row.surface}\u0000${city}`;
        const group = groups.get(key);
        if (group) {
            group.current += row.current;
            group.prior += row.prior;
        } else {
            groups.set(key, { city, surface: row.surface, current: row.current, prior: row.prior });
        }
    }
    const rows: CityRow[] = [];
    for (const group of groups.values()) {
        const shown = group.current >= CLUSTER_IMPRESSION_MINIMUM && group.prior >= CLUSTER_IMPRESSION_MINIMUM;
        rows.push({
            city: group.city,
            surface: group.surface,
            shown,
            impressions: shown ? group.current : null,
            priorImpressions: shown ? group.prior : null,
            display: shown ? String(group.current) : STATES_COPY.missingValue,
            reason: shown ? null : TOO_FEW_SEARCHES,
        });
    }
    rows.sort((a, b) => Number(b.shown) - Number(a.shown) || a.city.localeCompare(b.city) || a.surface.localeCompare(b.surface));
    return rows;
}

import type { ControlMode, DayPoint, Kpi, MetricRead } from './types';
import { dayKpi, isGaKpi } from './metrics';

/** Plain name for the comparison group. `none` means there is nothing to compare. */
export function controlModeLabel(mode: ControlMode): string {
    if (mode === 'none') return 'No comparison';
    if (mode === 'picked') return 'Selected control pages';
    if (mode === 'sitewide') return 'Whole site';
    return 'Rest of the site';
}

export interface ControlWindow {
    read: MetricRead | null;
    mode: ControlMode;
    unreliable: boolean;
    label: string;
}

function ctr(clicks: number, impressions: number): number | null {
    if (impressions <= 0) return null;
    return Math.round((clicks / impressions) * 10000) / 10000;
}

/**
 * Search Console counts impressions differently by property and by page, so
 * subtracting page counts from the property totals only approximates the rest
 * of the site. Position comes from impression-weighted, non-test page rows.
 */
export function controlFor(
    page: MetricRead,
    site: MetricRead | null,
    kpi: Kpi,
    restPosition?: MetricRead,
    picked?: MetricRead,
): ControlWindow {
    if (picked) {
        return {
            read: picked.measured ? picked : null,
            mode: 'picked',
            unreliable: picked.daysPresent < page.daysPresent,
            label: controlModeLabel('picked'),
        };
    }
    if (kpi === 'avg_position') {
        const read = restPosition?.position != null ? restPosition : null;
        const mode = read ? 'untouched' : 'none';
        return { read, mode, unreliable: (read?.daysPresent ?? 0) < page.daysPresent, label: controlModeLabel(mode) };
    }
    if (!site?.measured) {
        return { read: null, mode: 'none', unreliable: false, label: controlModeLabel('none') };
    }
    const position = restPosition?.position ?? null;
    // Fall back to the property trend for counts when the subtraction is unreliable.
    const fallback: ControlWindow = { read: { ...site, position }, mode: 'sitewide', unreliable: true, label: controlModeLabel('sitewide') };
    if (page.measured && page.daysPresent !== site.daysPresent) {
        return fallback;
    }
    const clicks = site.clicks - page.clicks;
    const impressions = site.impressions - page.impressions;
    const sessions = subtractNullable(site.organicSessions, page.organicSessions);
    const events = subtractNullable(site.keyEvents, page.keyEvents);
    const gscBroken = clicks < 0 || impressions < 0;
    const gaBroken = isGaKpi(kpi) && (sessions == null || events == null || sessions < 0 || events < 0);
    if (gscBroken || gaBroken) {
        return fallback;
    }
    return {
        read: {
            measured: true,
            clicks: Math.max(0, clicks),
            impressions: Math.max(0, impressions),
            ctr: ctr(Math.max(0, clicks), Math.max(0, impressions)),
            position,
            organicSessions: sessions == null ? null : Math.max(0, sessions),
            keyEvents: events == null ? null : Math.max(0, events),
            daysPresent: Math.min(page.daysPresent, site.daysPresent),
            daysExpected: page.daysExpected,
        },
        mode: 'untouched',
        unreliable: false,
        label: controlModeLabel('untouched'),
    };
}

function subtractNullable(site: number | null, page: number | null): number | null {
    if (site == null || page == null) return null;
    return site - page;
}

/** One day of the default comparison. The position series uses page facts only. */
export function controlDayValue(
    page: DayPoint | undefined,
    site: DayPoint | undefined,
    kpi: Kpi,
    restPosition?: DayPoint,
): number | null {
    if (kpi === 'avg_position') {
        return restPosition && !restPosition.preliminary ? dayKpi(restPosition, kpi) : null;
    }
    if (!site || site.preliminary) return null;
    if (page?.preliminary) return null;
    if (!page) return dayKpi(site, kpi);
    if (kpi === 'organic_sessions' || kpi === 'key_events') {
        const value = subtractNullable(dayKpi(site, kpi), dayKpi(page, kpi));
        return value != null && value >= 0 ? value : null;
    }
    const clicks = site.clicks - page.clicks;
    const impressions = site.impressions - page.impressions;
    if (clicks < 0 || impressions < 0) return null;
    if (kpi === 'clicks') return clicks;
    if (kpi === 'impressions') return impressions;
    return impressions > 0 ? clicks / impressions : null;
}

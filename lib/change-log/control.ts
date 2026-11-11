import type { ControlMode, DayPoint, Kpi, MetricRead } from './types';
import { isGaKpi } from './metrics';

/** Plain name for the comparison group. `none` means there is nothing to compare. */
export function controlModeLabel(mode: ControlMode): string {
    if (mode === 'none') return 'No comparison';
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
 * The rest of the site is the sitewide total minus the changed pages.
 * Position cannot be subtracted, so position uses the sitewide total.
 * A negative remainder means the slices don't share a base. Fall back to
 * the sitewide trend and say the control is unreliable.
 */
export function controlFor(page: MetricRead, site: MetricRead | null, kpi: Kpi): ControlWindow {
    if (!site?.measured) {
        return { read: null, mode: 'none', unreliable: false, label: controlModeLabel('none') };
    }
    if (kpi === 'avg_position') {
        return { read: site, mode: 'sitewide', unreliable: false, label: controlModeLabel('sitewide') };
    }
    if (page.measured && page.daysPresent !== site.daysPresent) {
        return { read: site, mode: 'sitewide', unreliable: true, label: controlModeLabel('sitewide') };
    }
    const clicks = site.clicks - page.clicks;
    const impressions = site.impressions - page.impressions;
    const sessions = subtractNullable(site.organicSessions, page.organicSessions);
    const events = subtractNullable(site.keyEvents, page.keyEvents);
    const gscBroken = clicks < 0 || impressions < 0;
    const gaBroken = isGaKpi(kpi) && (sessions == null || events == null || sessions < 0 || events < 0);
    if (gscBroken || (isGaKpi(kpi) && gaBroken)) {
        return { read: site, mode: 'sitewide', unreliable: true, label: controlModeLabel('sitewide') };
    }
    return {
        read: {
            measured: true,
            clicks: Math.max(0, clicks),
            impressions: Math.max(0, impressions),
            ctr: ctr(Math.max(0, clicks), Math.max(0, impressions)),
            position: site.position,
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

/** Chart series for the control. Position stays on the sitewide series. */
export function controlDayValue(page: DayPoint | undefined, site: DayPoint | undefined, kpi: Kpi): number | null {
    if (!site || site.preliminary) return null;
    if (!page) {
        if (kpi === 'avg_position') return site.impressions > 0 ? site.position : null;
        if (kpi === 'clicks') return site.clicks;
        if (kpi === 'impressions') return site.impressions;
        if (kpi === 'ctr') return site.impressions > 0 ? site.clicks / site.impressions : null;
        if (kpi === 'organic_sessions') return site.organicSessions;
        return site.keyEvents;
    }
    if (kpi === 'avg_position') return site.impressions > 0 ? site.position : null;
    const clicks = site.clicks - page.clicks;
    const impressions = site.impressions - page.impressions;
    if (clicks < 0 || impressions < 0) {
        if (kpi === 'clicks') return site.clicks;
        if (kpi === 'impressions') return site.impressions;
        if (kpi === 'ctr') return site.impressions > 0 ? site.clicks / site.impressions : null;
    }
    if (kpi === 'clicks') return Math.max(0, clicks);
    if (kpi === 'impressions') return Math.max(0, impressions);
    if (kpi === 'ctr') {
        const safeClicks = Math.max(0, clicks);
        const safeImpressions = Math.max(0, impressions);
        return safeImpressions > 0 ? safeClicks / safeImpressions : null;
    }
    if (kpi === 'organic_sessions') {
        if (site.organicSessions == null || page.organicSessions == null) return site.organicSessions;
        const value = site.organicSessions - page.organicSessions;
        return value < 0 ? site.organicSessions : value;
    }
    if (site.keyEvents == null || page.keyEvents == null) return site.keyEvents;
    const value = site.keyEvents - page.keyEvents;
    return value < 0 ? site.keyEvents : value;
}

import type { PortalPlanItem } from './progress';

export function portalDate(value?: string): string {
    if (!value) return 'Date to be confirmed';
    const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return 'Date to be confirmed';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function percentChange(current: number | null, previous: number | null): number | null {
    if (current === null || previous === null || previous <= 0) return null;
    return Math.round((current - previous) / previous * 1000) / 10;
}

export function metricNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export interface PortalPerformanceMonth {
    month: string;
    clicks: number | null;
    impressions: number | null;
    previousClicks: number | null;
    previousImpressions: number | null;
    reportId?: string;
}

export function first90Days(items: PortalPlanItem[], launchDate?: string) {
    const anchor = launchDate ? Date.parse(`${launchDate.slice(0, 10)}T00:00:00Z`) : NaN;
    if (!Number.isFinite(anchor)) return null;
    return [0, 1, 2].map(index => {
        const start = anchor + index * 30 * 86400000;
        const end = start + 30 * 86400000;
        const scheduled = items.filter(item => {
            const due = item.dueDate ? Date.parse(`${item.dueDate.slice(0, 10)}T00:00:00Z`) : NaN;
            return due >= start && due < end;
        });
        return {
            label: `Days ${index * 30 + 1}–${(index + 1) * 30}`,
            start: new Date(start).toISOString().slice(0, 10),
            end: new Date(end - 86400000).toISOString().slice(0, 10),
            items: scheduled,
            completed: scheduled.filter(item => item.status === 'done').length,
        };
    });
}

export function upcomingWeeks(items: PortalPlanItem[], today: string) {
    const anchor = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(anchor)) return [];
    return Array.from({ length: 5 }, (_, index) => {
        const start = anchor + index * 7 * 86400000;
        const end = start + 7 * 86400000;
        return {
            start: new Date(start).toISOString().slice(0, 10),
            end: new Date(end - 86400000).toISOString().slice(0, 10),
            items: items.filter(item => {
                const due = item.dueDate ? Date.parse(`${item.dueDate.slice(0, 10)}T00:00:00Z`) : NaN;
                return item.status === 'todo' && due >= start && due < end;
            }).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
        };
    });
}

export function portalToday(now = new Date()): string {
    return now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

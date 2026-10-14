import type { BingCronResult } from './run';

export interface BingSyncSummary {
    source: 'cron' | 'manual';
    sitesMapped: number;
    sitesSynced: number;
    remaining: number;
    errors: number[];
}

function count(value: number): number {
    return Number.isInteger(value) && value >= 0 && value <= 100000 ? value : 0;
}

function statuses(errors: number[]): number[] {
    return errors.filter(code => Number.isInteger(code) && code >= 100 && code <= 599);
}

/** One JSON line for Vercel logs. Counts and HTTP status codes only. */
export function logBingSyncSummary(summary: BingSyncSummary): void {
    console.log(JSON.stringify({
        event: 'bing_sync',
        source: summary.source === 'manual' ? 'manual' : 'cron',
        sitesMapped: count(summary.sitesMapped),
        sitesSynced: count(summary.sitesSynced),
        remaining: count(summary.remaining),
        errors: statuses(summary.errors),
    }));
}

export function summarizeBingCron(result: BingCronResult): BingSyncSummary {
    if ('enqueued' in result) {
        return {
            source: 'cron',
            sitesMapped: result.enqueued,
            sitesSynced: 0,
            remaining: result.enqueued,
            errors: [],
        };
    }
    return { source: 'cron', sitesMapped: 0, sitesSynced: 0, remaining: 0, errors: [] };
}

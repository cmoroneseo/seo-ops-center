import { parseLocalDate } from '../planner/local-date.ts';
import { formatDuration, formatWeekRange } from '../timesheets/format.ts';
import { weekStartFor } from '../timesheets/ledger.ts';
import type { ForecastBuildResult, ForecastPersonModel, ForecastRowModel } from './build.ts';
import type { ForecastReadiness } from './flags.ts';

/**
 * Labels for the sync preview. Unknown numbers stay an em dash with a reason.
 * A real zero is omitted before it gets here; this module does not invent one.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const FORECAST_REVIEW_HREF = '/timesheets?tab=imports';

export interface ForecastPreviewRowView {
    clientLabel: string;
    clientReason: string | null;
    sourceLabel: 'Actual' | 'Estimate';
    hoursLabel: string;
    hoursReason: string | null;
    allocationLabel: string;
    allocationReason: string | null;
}

export interface ForecastPreviewPersonView {
    userId: string;
    displayName: string;
    email: string;
    matchLabel: string | null;
    matchReason: string | null;
    rows: ForecastPreviewRowView[];
}

export interface ForecastPreviewSectionView {
    weekStart: string;
    heading: string;
    basisLabel: 'Actual' | 'Estimate';
    people: ForecastPreviewPersonView[];
    emptyLabel: string | null;
}

export interface ForecastPreviewWarningView {
    message: string;
    href?: string;
    hrefLabel?: string;
}

export interface ForecastPreviewView {
    sections: ForecastPreviewSectionView[];
    warnings: ForecastPreviewWarningView[];
    notes: string[];
    syncLabel: string;
    syncDisabled: boolean;
    syncDisabledReason: string | null;
}

const WARNING_COPY: Record<ForecastBuildResult['warnings'][number]['kind'], (count: number) => string> = {
    unmapped_entries: count => `${count} unmapped ${count === 1 ? 'entry is' : 'entries are'} not sent.`,
    unmapped_people: count => `${count} ${count === 1 ? 'person is' : 'people are'} not in Campaign Desk and will not be sent.`,
    missing_estimates: count => `${count} ${count === 1 ? 'task has' : 'tasks have'} no estimate and will not be sent.`,
    open_entries: count => `${count} open ${count === 1 ? 'entry is' : 'entries are'} not included.`,
    unassigned_tasks: count => `${count} ${count === 1 ? 'task is' : 'tasks are'} unassigned and will not be sent.`,
    multi_assignee_tasks: count => `${count} ${count === 1 ? 'task is' : 'tasks are'} assigned to more than one person and will not be sent.`,
    outside_org_tasks: count => `${count} ${count === 1 ? 'task is' : 'tasks are'} assigned outside this organization and will not be sent.`,
    all_day_meetings: count => `${count} all-day ${count === 1 ? 'meeting has' : 'meetings have'} no duration and will not be sent.`,
    missing_client_names: count => `${count} ${count === 1 ? 'line is' : 'lines are'} missing a client name and will not be sent.`,
    unreadable_hours: count => `${count} ${count === 1 ? 'entry has' : 'entries have'} hours that could not be read and will not be sent.`,
    missing_events: count => `${count} ${count === 1 ? 'entry is' : 'entries are'} linked to a planner event that could not be loaded and will not be sent.`,
    unreadable_starts: count => `${count} ${count === 1 ? 'task has' : 'tasks have'} a start date that could not be read and will not be sent.`,
};

export function forecastWeekChip(weekStart: string, today: string): string {
    const parsed = parseLocalDate(weekStart);
    if (!parsed) return weekStart;
    const short = `${MONTHS[parsed.getMonth()]} ${parsed.getDate()}`;
    return weekStart === weekStartFor(today) ? `This week · ${short}` : short;
}

export function syncButtonLabel(count: number): string {
    const weeks = count === 1 ? 'week' : 'weeks';
    return `Sync ${count} ${weeks}`;
}

export function formatLastSynced(
    at: string | null,
    by: string | null,
    timeZone: string,
): { label: string; reason: string | null } {
    if (!at) return { label: 'Not synced yet', reason: null };
    const date = new Date(at);
    if (Number.isNaN(date.getTime()) || !by?.trim()) {
        return { label: '—', reason: 'The last sync could not be read.' };
    }
    let formatted = '';
    try {
        formatted = new Intl.DateTimeFormat('en-US', {
            timeZone,
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        }).format(date);
    } catch {
        return { label: '—', reason: 'The last sync could not be read.' };
    }
    return { label: `Last synced ${formatted} by ${by.trim()}`, reason: null };
}

export function presentForecast(
    result: ForecastBuildResult,
    connection: ForecastReadiness,
    directoryError: string | null,
): ForecastPreviewView {
    const blocked = !connection.enabled
        ? connection.reason
        : directoryError;
    return {
        sections: result.weeks.map(week => ({
            weekStart: week.weekStart,
            heading: formatWeekRange(week.weekStart),
            basisLabel: week.basis === 'actual' ? 'Actual' : 'Estimate',
            people: week.people.map(presentPerson),
            emptyLabel: week.people.length === 0 ? 'No hours in this week.' : null,
        })),
        warnings: result.warnings.map(warning => ({
            message: WARNING_COPY[warning.kind](warning.count),
            ...(warning.kind === 'unmapped_entries'
                ? { href: FORECAST_REVIEW_HREF, hrefLabel: 'Review' }
                : {}),
        })),
        notes: forecastNotes(result),
        syncLabel: syncButtonLabel(result.weeks.length),
        syncDisabled: blocked != null,
        syncDisabledReason: blocked,
    };
}

function forecastNotes(result: ForecastBuildResult): string[] {
    const notes: string[] = [];
    if (result.weeks.some(week => week.basis === 'actual')) {
        notes.push('The current week and earlier weeks use tracked time. Scheduled work that has not been logged is left out.');
    }
    if (result.weeks.some(week => week.basis === 'estimate')) {
        notes.push('Later weeks use task estimates. Meetings are internal.');
    }
    if (result.breakMinutes > 0) {
        notes.push(`Breaks left out: ${formatDuration(result.breakMinutes)}.`);
    }
    if (result.allDayBreaks > 0) {
        notes.push(result.allDayBreaks === 1
            ? 'An all-day break is left out. It has no duration.'
            : `${result.allDayBreaks} all-day breaks are left out. They have no duration.`);
    }
    return notes;
}

function presentPerson(person: ForecastPersonModel): ForecastPreviewPersonView {
    const incomplete = person.rows.some(row => row.minutes == null);
    const total = person.rows.reduce((sum, row) => sum + (row.minutes ?? 0), 0);
    return {
        userId: person.userId,
        displayName: person.displayName,
        email: person.email,
        matchLabel: person.match.status === 'not_mapped'
            ? 'Not mapped'
            : person.match.status === 'unknown' ? '—' : null,
        matchReason: person.match.status === 'mapped' ? null : person.match.reason,
        rows: person.rows.map(row => presentRow(row, incomplete, total)),
    };
}

function presentRow(
    row: ForecastRowModel,
    incomplete: boolean,
    total: number,
): ForecastPreviewRowView {
    const hoursKnown = row.minutes != null;
    let allocationLabel = '—';
    let allocationReason: string | null = 'No hours';
    if (!hoursKnown) {
        allocationReason = row.minutesReason;
    } else if (incomplete) {
        allocationReason = 'Another row this week has no hours';
    } else if (total <= 0) {
        allocationReason = 'No hours';
    } else {
        allocationLabel = `${Math.round((row.minutes! / total) * 100)}%`;
        allocationReason = null;
    }
    return {
        clientLabel: row.clientName ?? '—',
        clientReason: row.clientName ? null : 'Client name is missing',
        sourceLabel: row.source === 'actual' ? 'Actual' : 'Estimate',
        hoursLabel: hoursKnown ? formatDuration(row.minutes!, { zero: '—' }) : '—',
        hoursReason: hoursKnown ? null : row.minutesReason,
        allocationLabel,
        allocationReason,
    };
}

export function forecastStatusLabel(
    status: 'synced' | 'changed' | 'not_mapped' | 'unknown',
): string {
    if (status === 'synced') return 'Synced';
    if (status === 'changed') return 'Changed since sync';
    if (status === 'not_mapped') return 'Not mapped';
    return '—';
}

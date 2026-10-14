'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { ForecastSyncButton } from '@/components/forecast/ForecastSyncButton';
import { cn } from '@/lib/utils';
import { formatLocalDate } from '@/lib/planner/local-date';
import { formatDayHeading, formatDuration } from '@/lib/timesheets/format';
import type { TeamSummary } from '@/lib/timesheets/team';

interface ForecastStatusResponse {
    available: boolean;
    lastSyncedLabel: string;
    lastSyncedReason: string | null;
    members: { userId: string; label: string; reason: string | null; tone: string }[];
}

interface TeamTimesheetViewProps {
    organizationId: string;
    weekStart: string;
}

/**
 * Manager view: people and exceptions.
 *
 * The attention rail on the right carries only things a human must decide.
 * Everything merely informational stays in the member rows, so a clean week
 * shows an empty rail rather than a wall of green checkmarks.
 */
export function TeamTimesheetView({ organizationId, weekStart }: TeamTimesheetViewProps) {
    const [summary, setSummary] = useState<TeamSummary | null>(null);
    const [forecast, setForecast] = useState<ForecastStatusResponse | null>(null);
    const [forecastError, setForecastError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const load = useCallback(async () => {
        if (!organizationId) return;
        setIsLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ organizationId, weekStart });
            const response = await fetch(`/api/timesheets/team?${params}`);
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error ?? 'Unable to load team timesheet');
            setSummary(payload.summary as TeamSummary);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Unable to load team timesheet');
            setSummary(null);
        } finally {
            setIsLoading(false);
        }
    }, [organizationId, weekStart]);

    const loadForecast = useCallback(async () => {
        if (!organizationId) return;
        setForecastError(null);
        try {
            const params = new URLSearchParams({
                organizationId,
                weekStart,
                today: formatLocalDate(new Date()),
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
            const response = await fetch(`/api/forecast/status?${params}`);
            const payload = await response.json() as ForecastStatusResponse & { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Forecast status could not be loaded.');
            setForecast(payload);
        } catch (loadError) {
            setForecast(null);
            setForecastError(loadError instanceof Error ? loadError.message : 'Forecast status could not be loaded.');
        }
    }, [organizationId, weekStart]);

    useEffect(() => { void load(); }, [load]);
    useEffect(() => { void loadForecast(); }, [loadForecast]);

    const toggle = (userId: string) => {
        setExpanded(previous => {
            const next = new Set(previous);
            if (next.has(userId)) next.delete(userId);
            else next.add(userId);
            return next;
        });
    };

    if (isLoading && !summary) {
        return <p className="p-6 text-sm text-muted-foreground">Loading team timesheet…</p>;
    }
    if (error) {
        return (
            <p role="alert" className="m-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
            </p>
        );
    }
    if (!summary) return null;

    const forecastByUser = new Map((forecast?.members ?? []).map(member => [member.userId, member]));

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
            <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted-foreground">
                    {forecastError
                        ? '—'
                        : forecast?.lastSyncedLabel ?? 'Loading forecast status…'}
                    {(forecastError || forecast?.lastSyncedReason) && (
                        <span className="ml-2">{forecastError ?? forecast?.lastSyncedReason}</span>
                    )}
                </p>
                <div className="ml-auto">
                    <ForecastSyncButton
                        organizationId={organizationId}
                        variant="primary"
                        onSynced={() => { void loadForecast(); }}
                    />
                </div>
            </div>
            <div className="flex min-h-0 flex-1 gap-4">
            <div className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full min-w-[880px] border-collapse text-sm">
                    <caption className="sr-only">Team time by member for the week</caption>
                    <thead>
                        <tr className="border-b border-border">
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Member
                            </th>
                            <th scope="col" className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Tracked
                            </th>
                            <th scope="col" className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                SEO budget
                            </th>
                            <th scope="col" className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Non-budget
                            </th>
                            <th scope="col" className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Internal
                            </th>
                            <th scope="col" className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Unmapped
                            </th>
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Forecast
                            </th>
                        </tr>
                    </thead>

                    <tbody>
                        {summary.members.map(member => {
                            const isOpen = expanded.has(member.userId);
                            const Chevron = isOpen ? ChevronDown : ChevronRight;
                            return (
                                <Fragment key={member.userId}>
                                    <tr className="border-b border-border">
                                        <th scope="row" className="px-4 py-3 text-left font-normal">
                                            <button
                                                type="button"
                                                onClick={() => toggle(member.userId)}
                                                aria-expanded={isOpen}
                                                className="flex items-center gap-2 rounded text-sm font-medium text-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                            >
                                                <Chevron className="h-4 w-4 text-muted-foreground" aria-hidden />
                                                {member.displayName}
                                            </button>
                                        </th>
                                        <td className="px-3 py-3 text-right font-medium tabular-nums">
                                            {formatDuration(member.totalMinutes, { zero: '0m' })}
                                        </td>
                                        <td className="px-3 py-3 text-right tabular-nums text-primary">
                                            {formatDuration(member.budgetMinutes, { zero: '0m' })}
                                        </td>
                                        <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                                            {formatDuration(member.nonBudgetMinutes, { zero: '0m' })}
                                        </td>
                                        <td className="px-3 py-3 text-right tabular-nums text-sky-400">
                                            {formatDuration(member.internalMinutes, { zero: '0m' })}
                                        </td>
                                        <td className={cn(
                                            'px-3 py-3 text-right tabular-nums',
                                            member.unmappedCount > 0 ? 'text-amber-500' : 'text-muted-foreground',
                                        )}>
                                            {member.unmappedCount}
                                        </td>
                                        <ForecastCell
                                            status={forecastByUser.get(member.userId)}
                                            pending={!forecast && !forecastError}
                                            unavailable={forecastError ?? (forecast && !forecast.available ? forecast.lastSyncedReason : null)}
                                        />
                                    </tr>

                                    {isOpen && (
                                        <tr className="border-b border-border bg-muted/20">
                                            <td colSpan={7} className="px-4 py-3">
                                                <ul className="flex flex-wrap gap-4">
                                                    {summary.days.map((day, index) => {
                                                        const heading = formatDayHeading(day);
                                                        return (
                                                            <li key={day} className="text-xs">
                                                                <span className="block text-muted-foreground">
                                                                    {heading.weekday} {heading.date}
                                                                </span>
                                                                <span className="block tabular-nums text-foreground">
                                                                    {formatDuration(member.dailyMinutes[index], { zero: '0m' })}
                                                                </span>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </tbody>

                    <tfoot>
                        <tr className="border-t border-border">
                            <th scope="row" className="px-4 py-3 text-left font-medium">Team total</th>
                            <td className="px-3 py-3 text-right font-semibold tabular-nums">
                                {formatDuration(summary.totals.totalMinutes, { zero: '0m' })}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">
                                {formatDuration(summary.totals.budgetMinutes, { zero: '0m' })}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">
                                {formatDuration(summary.totals.nonBudgetMinutes, { zero: '0m' })}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">
                                {formatDuration(summary.totals.internalMinutes, { zero: '0m' })}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">
                                {summary.totals.unmappedCount}
                            </td>
                            <td />
                        </tr>
                    </tfoot>
                </table>
            </div>

            <aside aria-label="Requires attention" className="w-[320px] shrink-0">
                <div className="rounded-xl border border-border bg-card p-4">
                    <h2 className="text-sm font-medium text-foreground">Requires attention</h2>

                    {summary.exceptions.length === 0 ? (
                        <p className="mt-3 text-sm text-muted-foreground">
                            Nothing needs a decision this week.
                        </p>
                    ) : (
                        <ul className="mt-3 space-y-2">
                            {summary.exceptions.map(exception => {
                                const heading = formatDayHeading(exception.date);
                                return (
                                    <li key={exception.timeLogId}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                window.dispatchEvent(
                                                    new CustomEvent('timesheets:open-imports'),
                                                );
                                            }}
                                            className="w-full rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-left hover:bg-amber-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                        >
                                            <span className="flex items-center justify-between gap-2 text-sm text-foreground">
                                                <span className="flex items-center gap-2">
                                                    <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
                                                    Unmapped entry
                                                </span>
                                                <span className="tabular-nums">
                                                    {formatDuration(exception.minutes, { zero: '0m' })}
                                                </span>
                                            </span>
                                            <span className="mt-1 block text-xs text-muted-foreground">
                                                {heading.weekday} {heading.date}
                                                {exception.description ? ` · ${exception.description}` : ''}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </aside>
            </div>
        </div>
    );
}

function ForecastCell({
    status,
    pending,
    unavailable,
}: {
    status?: { label: string; reason: string | null; tone: string };
    pending: boolean;
    unavailable: string | null;
}) {
    if (pending) return <td className="px-4 py-3 text-muted-foreground" />;
    if (unavailable) {
        return (
            <td className="px-4 py-3 text-muted-foreground">
                —
                <span className="mt-0.5 block text-xs">{unavailable}</span>
            </td>
        );
    }
    if (!status) {
        return (
            <td className="px-4 py-3 text-muted-foreground">
                —
                <span className="mt-0.5 block text-xs">Forecast status could not be loaded.</span>
            </td>
        );
    }
    return (
        <td className={cn(
            'px-4 py-3',
            status.tone === 'changed' ? 'text-amber-500' : 'text-foreground',
            status.tone === 'not_mapped' || status.tone === 'unknown' ? 'text-muted-foreground' : '',
        )}>
            {status.label}
            {status.reason && <span className="mt-0.5 block text-xs text-muted-foreground">{status.reason}</span>}
        </td>
    );
}

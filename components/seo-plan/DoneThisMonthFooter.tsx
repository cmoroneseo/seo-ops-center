'use client';

import { LiveUrlControl } from '@/components/tasks/LiveUrlControl';
import {
    doneThisMonth,
    formatFooterHours,
    type DoneThisMonthLog,
} from '@/lib/seo-plan/done-this-month';
import type { StageListTask } from '@/lib/seo-plan/stage-list';
import { STAGE_LIST_TIME_ZONE } from '@/lib/seo-plan/this-month';
import { cn } from '@/lib/utils';

/**
 * Mini client report under the plan list.
 * Zeros stay muted grey. Hours are billable time; the hover splits out the rest.
 */
export function DoneThisMonthFooter({
    tasks,
    logs,
    hoursPending = false,
    month,
    timeZone = STAGE_LIST_TIME_ZONE,
    clientId,
    onOpenResults,
}: {
    tasks: readonly StageListTask[];
    logs?: readonly DoneThisMonthLog[] | null;
    /** True while the month's time logs are still loading. */
    hoursPending?: boolean;
    month: string;
    timeZone?: string;
    clientId?: string;
    onOpenResults?: (month: string) => void;
}) {
    const report = doneThisMonth({
        tasks,
        logs: hoursPending ? [] : (logs ?? []),
        month,
        timeZone,
        clientId,
    });
    const hoursText = hoursPending ? '—' : formatFooterHours(report.billableHours);
    const hoursZero = hoursPending || hoursText === '0.0h';

    return (
        <footer
            data-plan-footer
            aria-label="Done this month"
            className="rounded-[10px] border border-[#2a2a2e] bg-[#141416] px-4 py-3"
        >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <h2 className="text-[13px] font-semibold text-[#ececee]">Done this month</h2>
                    <p className="text-[11.5px] text-[#8b8b93]">
                        {report.monthTitle} · tasks completed and time logged in {report.monthShort}
                    </p>
                </div>
                {onOpenResults && (
                    <button
                        type="button"
                        onClick={() => onOpenResults(month)}
                        className="shrink-0 text-[13px] font-medium text-[#ec4899] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                    >
                        Open in Results →
                    </button>
                )}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-10 gap-y-3">
                <Stat
                    value={String(report.completedCount)}
                    label="tasks completed"
                    zero={report.completedCount === 0}
                    attr="data-plan-completed"
                />
                <Stat
                    value={String(report.urlCount)}
                    label="live URLs"
                    zero={report.urlCount === 0}
                    attr="data-plan-urls"
                />
                <Stat
                    value={hoursText}
                    label="logged · running timer adds on stop"
                    zero={hoursZero}
                    attr="data-plan-hours"
                    title={hoursPending ? undefined : report.hoursTitle}
                />
            </div>
            {(report.urls.length > 0 || report.missingUrlCount > 0) && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {report.urls.map(item => (
                        <span key={item.id} className="max-w-56 min-w-0" data-plan-url={item.id}>
                            <LiveUrlControl url={item.url} />
                        </span>
                    ))}
                    {report.missingUrlCount > 0 && (
                        <span className="text-[12px] text-[#8b8b93]" data-plan-missing-urls={report.missingUrlCount}>
                            +{report.missingUrlCount} without a URL
                        </span>
                    )}
                </div>
            )}
            {report.emptyCopy && (
                <p className="mt-3 text-[13px] text-[#8b8b93]">{report.emptyCopy}</p>
            )}
        </footer>
    );
}

function Stat({
    value,
    label,
    zero,
    title,
    attr,
}: {
    value: string;
    label: string;
    zero: boolean;
    title?: string;
    attr: 'data-plan-completed' | 'data-plan-urls' | 'data-plan-hours';
}) {
    return (
        <div>
            <div
                {...{ [attr]: value }}
                data-zero={zero ? 'true' : 'false'}
                title={title}
                className={cn(
                    'text-[22px] font-semibold leading-none tabular-nums',
                    zero ? 'text-[#8b8b93]' : 'text-[#ececee]',
                )}
            >
                {value}
            </div>
            <div className="mt-1 text-[11px] text-[#8b8b93]">{label}</div>
        </div>
    );
}

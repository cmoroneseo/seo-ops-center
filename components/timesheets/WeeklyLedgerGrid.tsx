'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDayHeading, formatDuration } from '@/lib/timesheets/format';
import type { WeeklyLedger, LedgerClientGroup } from '@/lib/timesheets/ledger';

interface WeeklyLedgerGridProps {
    ledger: WeeklyLedger;
    /** yyyy-MM-dd of today, so the current column can be marked. */
    today: string;
    selectedRowKey: string | null;
    onSelectRow: (rowKey: string | null) => void;
}

function groupId(group: LedgerClientGroup) {
    return group.needsReview ? 'review' : group.clientId ?? 'internal';
}

/**
 * The Ledger Grid: client/task rows against seven local-date columns.
 *
 * Deliberately quiet — source and mapping state are dots and labels, not
 * badges competing with the numbers. Anything actionable (an unmapped import)
 * is the one place amber appears.
 */
export function WeeklyLedgerGrid({
    ledger,
    today,
    selectedRowKey,
    onSelectRow,
}: WeeklyLedgerGridProps) {
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    const toggle = (id: string) => {
        setCollapsed(previous => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const columnClass = 'w-[104px] px-3 py-3 text-right tabular-nums';

    return (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[880px] border-collapse text-sm">
                <caption className="sr-only">
                    Weekly time ledger by client and task
                </caption>
                <thead>
                    <tr className="border-b border-border">
                        <th
                            scope="col"
                            className="sticky left-0 z-10 bg-card px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
                        >
                            Client / Task
                        </th>
                        {ledger.days.map(day => {
                            const heading = formatDayHeading(day);
                            const isToday = day === today;
                            return (
                                <th
                                    key={day}
                                    scope="col"
                                    aria-current={isToday ? 'date' : undefined}
                                    className={cn(
                                        columnClass,
                                        'text-center align-bottom font-medium',
                                        isToday
                                            ? 'border-b-2 border-primary text-foreground'
                                            : 'text-muted-foreground',
                                    )}
                                >
                                    <span className="block text-xs">{heading.weekday}</span>
                                    <span className="block text-xs">{heading.date}</span>
                                </th>
                            );
                        })}
                        <th
                            scope="col"
                            className={cn(columnClass, 'text-right text-xs font-medium uppercase tracking-wide text-muted-foreground')}
                        >
                            Total
                        </th>
                    </tr>
                </thead>

                <tbody>
                    {ledger.clients.length === 0 && (
                        <tr>
                            <td
                                colSpan={ledger.days.length + 2}
                                className="px-4 py-10 text-center text-sm text-muted-foreground"
                            >
                                No time logged this week.
                            </td>
                        </tr>
                    )}

                    {ledger.clients.map(group => {
                        const id = groupId(group);
                        const isCollapsed = collapsed.has(id);

                        return (
                            <FragmentGroup
                                key={id}
                                group={group}
                                groupKey={id}
                                isCollapsed={isCollapsed}
                                onToggle={() => toggle(id)}
                                days={ledger.days}
                                today={today}
                                columnClass={columnClass}
                                selectedRowKey={selectedRowKey}
                                onSelectRow={onSelectRow}
                            />
                        );
                    })}
                </tbody>

                <tfoot>
                    <tr className="border-t border-border">
                        <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-3 text-left font-medium">
                            Daily total
                        </th>
                        {ledger.totals.dailyMinutes.map((minutes, index) => (
                            <td
                                key={ledger.days[index]}
                                className={cn(
                                    columnClass,
                                    'text-center font-medium',
                                    ledger.days[index] === today && 'text-foreground',
                                )}
                            >
                                {formatDuration(minutes, { zero: '0m' })}
                            </td>
                        ))}
                        <td className={cn(columnClass, 'font-semibold')}>
                            {formatDuration(ledger.totals.totalMinutes, { zero: '0m' })}
                        </td>
                    </tr>
                    <tr className="border-t border-border bg-muted/30">
                        <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-3 text-left font-medium">
                            Weekly total
                        </th>
                        <td colSpan={ledger.days.length} />
                        <td className={cn(columnClass, 'text-base font-semibold')}>
                            {formatDuration(ledger.totals.totalMinutes, { zero: '0m' })}
                        </td>
                    </tr>
                </tfoot>
            </table>
        </div>
    );
}

interface FragmentGroupProps {
    group: LedgerClientGroup;
    groupKey: string;
    isCollapsed: boolean;
    onToggle: () => void;
    days: string[];
    today: string;
    columnClass: string;
    selectedRowKey: string | null;
    onSelectRow: (rowKey: string | null) => void;
}

function FragmentGroup({
    group,
    groupKey,
    isCollapsed,
    onToggle,
    days,
    today,
    columnClass,
    selectedRowKey,
    onSelectRow,
}: FragmentGroupProps) {
    const Chevron = isCollapsed ? ChevronRight : ChevronDown;

    return (
        <>
            <tr className="border-b border-border">
                <th scope="rowgroup" className="sticky left-0 z-10 bg-card px-4 py-3 text-left">
                    <button
                        type="button"
                        onClick={onToggle}
                        aria-expanded={!isCollapsed}
                        aria-controls={`ledger-group-${groupKey}`}
                        className="flex items-center gap-2 rounded text-sm font-medium text-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        <Chevron className="h-4 w-4 text-muted-foreground" aria-hidden />
                        {group.needsReview && (
                            <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
                        )}
                        {group.clientName}
                    </button>
                </th>
                {days.map(day => <td key={day} className={columnClass} />)}
                <td className={cn(columnClass, 'font-medium')}>
                    {formatDuration(group.totalMinutes, { zero: '0m' })}
                </td>
            </tr>

            {!isCollapsed && group.rows.map(row => {
                const isSelected = row.key === selectedRowKey;
                return (
                    <tr
                        key={row.key}
                        id={`ledger-group-${groupKey}`}
                        aria-selected={isSelected}
                        className={cn(
                            'border-b border-border transition-colors',
                            isSelected
                                ? 'outline outline-2 -outline-offset-2 outline-primary'
                                : 'hover:bg-muted/40',
                        )}
                    >
                        <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-3 text-left font-normal">
                            <button
                                type="button"
                                onClick={() => onSelectRow(isSelected ? null : row.key)}
                                className="flex w-full items-start gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            >
                                <span
                                    aria-hidden
                                    className={cn(
                                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                                        row.needsReview
                                            ? 'bg-amber-500'
                                            : row.sources.includes('basecamp')
                                                ? 'bg-sky-400'
                                                : 'bg-primary',
                                    )}
                                />
                                <span className="text-foreground">{row.taskTitle}</span>
                            </button>
                        </th>

                        {row.dailyMinutes.map((minutes, index) => (
                            <td
                                key={days[index]}
                                className={cn(
                                    columnClass,
                                    'text-center',
                                    minutes === 0 ? 'text-muted-foreground' : 'text-foreground',
                                    days[index] === today && 'bg-muted/20',
                                )}
                            >
                                {formatDuration(minutes)}
                            </td>
                        ))}

                        <td className={cn(columnClass, 'font-medium')}>
                            {formatDuration(row.totalMinutes, { zero: '0m' })}
                        </td>
                    </tr>
                );
            })}

            {!isCollapsed && group.rows.length > 0 && (
                <tr className="border-b border-border bg-muted/20">
                    <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-3 pl-10 text-left text-xs font-normal text-muted-foreground">
                        {group.needsReview ? 'Needs attention total' : 'Client total'}
                    </th>
                    {group.dailyMinutes.map((minutes, index) => (
                        <td
                            key={days[index]}
                            className={cn(columnClass, 'text-center text-muted-foreground')}
                        >
                            {formatDuration(minutes)}
                        </td>
                    ))}
                    <td className={cn(columnClass, 'font-medium')}>
                        {formatDuration(group.totalMinutes, { zero: '0m' })}
                    </td>
                </tr>
            )}
        </>
    );
}

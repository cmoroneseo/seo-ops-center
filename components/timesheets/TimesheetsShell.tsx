'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { formatDuration, formatWeekRange, percentOf } from '@/lib/timesheets/format';
import { weekStartFor, type WeeklyLedger, type LedgerLog } from '@/lib/timesheets/ledger';
import { formatLocalDate, parseLocalDate } from '@/lib/planner/local-date';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { WeeklyLedgerGrid } from './WeeklyLedgerGrid';
import { LedgerInspector } from './LedgerInspector';
import { TeamTimesheetView } from './TeamTimesheetView';
import { ClientReviewView } from './ClientReviewView';
import { ImportReviewView } from './ImportReviewView';

type Tab = 'mine' | 'imports' | 'team' | 'review';

interface LedgerResponse {
    userId: string | null;
    role: string;
    isManager: boolean;
    ledger: WeeklyLedger;
    entries: LedgerLog[];
}

function shiftWeek(weekStart: string, weeks: number): string {
    const parsed = parseLocalDate(weekStart);
    if (!parsed) return weekStart;
    parsed.setDate(parsed.getDate() + weeks * 7);
    return formatLocalDate(parsed);
}

const TABS: { id: Tab; label: string; managerOnly: boolean }[] = [
    { id: 'mine', label: 'My timesheet', managerOnly: false },
    { id: 'imports', label: 'Imports', managerOnly: false },
    { id: 'team', label: 'Team', managerOnly: true },
    { id: 'review', label: 'Client review', managerOnly: true },
];

interface TeamMember {
    userId: string;
    displayName: string;
    basecampPersonId?: string;
}

export function TimesheetsShell() {
    const { organization } = useOrganization();
    const { userId, isLoading: memberLoading } = useCurrentMember();
    const [members, setMembers] = useState<TeamMember[]>([]);

    const today = useMemo(() => formatLocalDate(new Date()), []);
    const [tab, setTab] = useState<Tab>('mine');
    const [weekStart, setWeekStart] = useState(() => weekStartFor(formatLocalDate(new Date())));
    const [viewUserId, setViewUserId] = useState<string | null>(null);
    const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
    const [data, setData] = useState<LedgerResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const organizationId = organization?.id ?? '';
    const targetUserId = viewUserId ?? userId;
    const isManager = data?.isManager ?? false;

    const load = useCallback(async () => {
        if (!organizationId || !targetUserId) return;
        setIsLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ organizationId, weekStart, userId: targetUserId });
            const response = await fetch(`/api/timesheets/ledger?${params}`);
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error ?? 'Unable to load timesheet');
            setData(payload as LedgerResponse);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Unable to load timesheet');
            setData(null);
        } finally {
            setIsLoading(false);
        }
    }, [organizationId, weekStart, targetUserId]);

    useEffect(() => { void load(); }, [load]);

    // The member filter lists the organization's people, not the current
    // user's org memberships — those are two different things.
    useEffect(() => {
        if (!organizationId) return;
        let active = true;
        setMembers([]);
        void getOrganizationMembers(organizationId).then(rows => {
            if (!active) return;
            setMembers(rows.map(row => ({
                userId: row.userId,
                displayName: row.user.fullName || row.user.email.split('@')[0],
                basecampPersonId: row.basecampPersonId,
            })));
        });
        return () => { active = false; };
    }, [organizationId]);

    // Changing the week invalidates the selected row's identity.
    useEffect(() => { setSelectedRowKey(null); }, [weekStart, targetUserId]);

    const ledger = data?.ledger ?? null;
    const selected = useMemo(() => {
        if (!ledger || !selectedRowKey) return null;
        for (const group of ledger.clients) {
            const row = group.rows.find(candidate => candidate.key === selectedRowKey);
            if (row) return { group, row };
        }
        return null;
    }, [ledger, selectedRowKey]);

    const visibleTabs = TABS.filter(entry => !entry.managerOnly || isManager);
    const backfillMembers = useMemo(() => members.map(member => ({
        userId: member.userId,
        label: member.displayName,
        hasBasecampPerson: Boolean(member.basecampPersonId),
    })), [members]);

    if (memberLoading) {
        return <p className="p-6 text-sm text-muted-foreground">Loading timesheet…</p>;
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-border px-6">
                <nav aria-label="Timesheet views" className="flex gap-6">
                    {visibleTabs.map(entry => (
                        <button
                            key={entry.id}
                            type="button"
                            onClick={() => setTab(entry.id)}
                            aria-current={tab === entry.id ? 'page' : undefined}
                            className={cn(
                                'border-b-2 px-1 py-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                                tab === entry.id
                                    ? 'border-primary text-foreground'
                                    : 'border-transparent text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {entry.label}
                        </button>
                    ))}
                </nav>
            </div>

            {tab === 'team' && isManager && (
                <TeamTimesheetView organizationId={organizationId} weekStart={weekStart} />
            )}

            {tab === 'review' && isManager && (
                <ClientReviewView organizationId={organizationId} />
            )}

            {tab === 'imports' && (
                <ImportReviewView
                    key={organizationId}
                    organizationId={organizationId}
                    backfillMembers={backfillMembers}
                />
            )}

            {tab === 'mine' && (
                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex flex-wrap items-center gap-3 px-6 py-4">
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                aria-label="Previous week"
                                onClick={() => setWeekStart(current => shiftWeek(current, -1))}
                                className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            >
                                <ChevronLeft className="h-5 w-5" aria-hidden />
                            </button>
                            <button
                                type="button"
                                aria-label="Next week"
                                onClick={() => setWeekStart(current => shiftWeek(current, 1))}
                                className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            >
                                <ChevronRight className="h-5 w-5" aria-hidden />
                            </button>
                        </div>

                        <h1 className="text-lg font-semibold text-foreground">
                            {formatWeekRange(weekStart)}
                        </h1>

                        <button
                            type="button"
                            onClick={() => setWeekStart(weekStartFor(today))}
                            className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                            Today
                        </button>

                        {isManager && members.length > 1 && (
                            <div className="ml-auto flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">Member:</span>
                                <div className="flex overflow-hidden rounded-lg border border-border">
                                    <button
                                        type="button"
                                        onClick={() => setViewUserId(null)}
                                        aria-pressed={targetUserId === userId}
                                        className={cn(
                                            'px-3 py-1.5 text-sm',
                                            targetUserId === userId
                                                ? 'bg-primary text-primary-foreground'
                                                : 'text-muted-foreground hover:bg-muted',
                                        )}
                                    >
                                        Mine
                                    </button>
                                    {members
                                        .filter(member => member.userId !== userId)
                                        .map(member => (
                                            <button
                                                key={member.userId}
                                                type="button"
                                                onClick={() => setViewUserId(member.userId)}
                                                aria-pressed={targetUserId === member.userId}
                                                className={cn(
                                                    'border-l border-border px-3 py-1.5 text-sm',
                                                    targetUserId === member.userId
                                                        ? 'bg-primary text-primary-foreground'
                                                        : 'text-muted-foreground hover:bg-muted',
                                                )}
                                            >
                                                {member.displayName}
                                            </button>
                                        ))}
                                </div>
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={() => window.dispatchEvent(new CustomEvent('timer:open-quick-start'))}
                            className={cn(
                                'flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                                !(isManager && members.length > 1) && 'ml-auto',
                            )}
                        >
                            <Plus className="h-4 w-4" aria-hidden />
                            Add time
                        </button>
                    </div>

                    {error && (
                        <p role="alert" className="mx-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                            {error}
                        </p>
                    )}

                    {ledger && <SummaryStrip ledger={ledger} />}

                    <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto px-6 pb-6">
                        <div className="min-w-0 flex-1">
                            {isLoading && !ledger
                                ? <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
                                : ledger && (
                                    <WeeklyLedgerGrid
                                        ledger={ledger}
                                        today={today}
                                        selectedRowKey={selectedRowKey}
                                        onSelectRow={setSelectedRowKey}
                                    />
                                )}
                        </div>

                        {selected && (
                            <div className="w-[400px] shrink-0">
                                <LedgerInspector
                                    group={selected.group}
                                    row={selected.row}
                                    entries={data?.entries ?? []}
                                    onClose={() => setSelectedRowKey(null)}
                                    onAddTime={() =>
                                        window.dispatchEvent(new CustomEvent('timer:open-quick-start'))}
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function SummaryStrip({ ledger }: { ledger: WeeklyLedger }) {
    const { totals } = ledger;
    const tiles = [
        { label: 'SEO budget hours', minutes: totals.budgetMinutes, accent: 'text-primary' },
        { label: 'Non-budget hours', minutes: totals.nonBudgetMinutes, accent: 'text-muted-foreground' },
        { label: 'Internal hours', minutes: totals.internalMinutes, accent: 'text-sky-400' },
    ];

    return (
        <div className="grid grid-cols-2 gap-3 px-6 pb-4 lg:grid-cols-4">
            {tiles.map(tile => (
                <div key={tile.label} className="rounded-xl border border-border bg-card p-4">
                    <p className="text-xs text-muted-foreground">{tile.label}</p>
                    <p className={cn('mt-1 text-2xl font-semibold tabular-nums', tile.accent)}>
                        {formatDuration(tile.minutes, { zero: '0m' })}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {percentOf(tile.minutes, totals.totalMinutes)}% of{' '}
                        {formatDuration(totals.totalMinutes, { zero: '0m' })}
                    </p>
                </div>
            ))}

            <div
                className={cn(
                    'rounded-xl border p-4',
                    totals.unmappedCount > 0
                        ? 'border-amber-500/40 bg-amber-500/5'
                        : 'border-border bg-card',
                )}
            >
                <p className="text-xs text-muted-foreground">Requires attention</p>
                <p className="mt-1 flex items-center gap-2 text-2xl font-semibold tabular-nums text-foreground">
                    {totals.unmappedCount}
                    {totals.unmappedCount > 0 && (
                        <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />
                    )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                    {totals.unmappedCount === 1 ? 'Unmapped entry' : 'Unmapped entries'}
                </p>
            </div>
        </div>
    );
}

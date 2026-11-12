'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, Download, Info, MoreHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import type { ChartMarker } from '@/lib/change-log/chart';
import { impactCsv } from '@/lib/change-log/csv';
import { addedWords, removedWords, wordDiff, type DiffToken } from '@/lib/change-log/diff';
import { overlapLabel } from '@/lib/change-log/impact';
import { formatHeadlinePct, headlineFields, pagePath } from '@/lib/change-log/list';
import {
    EARLY_ESTIMATE_NOTE,
    TERMS_EMPTY_COPY,
    TERMS_MISSING_NOTE,
    answerLine,
    buildResultsTable,
    changeTone,
    formatChangePercent,
    formatResultsValue,
    formatTermValue,
    notReadyCopy,
    searchTermsEmpty,
    termsHaveGaps,
} from '@/lib/change-log/results';
import { checkSchedule, type CheckDate } from '@/lib/change-log/schedule';
import { nextStep } from '@/lib/change-log/verdict';
import { afterWindow, formatDay, formatDayWithYear, formatWentLive, isIsoDay } from '@/lib/change-log/time';
import {
    CHANGE_TYPE_HINT,
    CHANGE_TYPE_LABEL,
    KPI_HINT,
    KPI_LABEL,
    SEARCH_CONSOLE_HINT,
    TREATMENT_LABEL,
    type ChangePage,
    type CheckpointRead,
    type Confounder,
    type QueryCompare,
    type RateDelta,
    type SeoChange,
    type ImpactModel,
} from '@/lib/change-log/types';
import { ptToday } from '@/lib/sync/months';
import { cn } from '@/lib/utils';

import { GroupResults } from './GroupResults';
import { ImpactChart } from './ImpactChart';
import { TestProgressCard } from './TestProgress';
import { VerdictPill } from './VerdictPill';

type SortKey = 'query' | 'clicks' | 'impressions' | 'position';

export function ChangeDetail({
    change,
    impact,
    confounders,
    baselineNote,
    example,
    canEdit = true,
    markers,
    revertInitiallyOpen = false,
    today,
    onBack,
    onOpen,
    onRemove,
}: {
    change: SeoChange;
    impact: ImpactModel;
    confounders: Confounder[];
    baselineNote: string | null;
    example: boolean;
    /** Viewers do not get Remove from log. */
    canEdit?: boolean;
    /** Other logged changes on the same page. */
    markers: ChartMarker[];
    revertInitiallyOpen?: boolean;
    /** Pacific date for the "Today" marker. Defaults to today. */
    today?: string;
    onBack: () => void;
    onOpen: (id: string) => void;
    onRemove: () => void;
}) {
    const [revertOpen, setRevertOpen] = useState(revertInitiallyOpen);
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'impressions', dir: 'desc' });
    const [downloadOpen, setDownloadOpen] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const head = impact.headline;
    const grouped = change.testKind === 'group';
    const queries = useMemo(() => sortQueries(impact.queries, sort), [impact.queries, sort]);
    const asOf = today && isIsoDay(today) ? today : ptToday(new Date());
    const headlinePct = head.ready ? headlineFields(head).headlinePct : null;

    function downloadCsv() {
        const blob = new Blob([impactCsv(change, impact)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${change.title.replace(/\s+/g, '-').toLowerCase()}-impact.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }

    async function copyLink() {
        try {
            await navigator.clipboard?.writeText(window.location.href);
            setCopied(true);
        } catch {
            setCopied(false);
        }
    }

    function toggle(key: SortKey) {
        setSort(current => current.key === key
            ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
            : { key, dir: key === 'query' ? 'asc' : 'desc' });
    }

    return (
        <div className="change-log-sheet space-y-4">
            <div className="change-log-no-print flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onBack}>
                    <ChevronLeft />
                    All changes
                </Button>
                <div className="flex items-center gap-2">
                    <ActionMenu
                        menuLabel="Download"
                        open={downloadOpen}
                        onOpenChange={next => {
                            setDownloadOpen(next);
                            if (next) setMoreOpen(false);
                        }}
                        label={<><Download /> Download <ChevronDown /></>}
                    >
                        <MenuItem onClick={() => { setDownloadOpen(false); downloadCsv(); }}>Spreadsheet (CSV)</MenuItem>
                        <MenuItem onClick={() => { setDownloadOpen(false); window.print?.(); }}>Print or save as PDF</MenuItem>
                    </ActionMenu>
                    <ActionMenu
                        menuLabel="More actions"
                        open={moreOpen}
                        onOpenChange={next => {
                            setMoreOpen(next);
                            if (next) setDownloadOpen(false);
                        }}
                        label={<MoreHorizontal />}
                    >
                        <MenuItem onClick={() => { void copyLink(); }}>
                            {copied ? 'Link copied' : 'Copy link to this change'}
                        </MenuItem>
                        <MenuItem onClick={() => { setMoreOpen(false); window.print?.(); }}>Print or save as PDF</MenuItem>
                        {canEdit && !example && (
                            <MenuItem
                                destructive
                                onClick={() => {
                                    setMoreOpen(false);
                                    setConfirmOpen(true);
                                }}
                            >
                                Remove from log…
                                <span className="mt-0.5 block text-xs font-normal">Asks you to confirm first</span>
                            </MenuItem>
                        )}
                    </ActionMenu>
                </div>
            </div>

            <section className="rounded-lg border border-border bg-card p-5">
                <p className="text-xs text-muted-foreground">
                    {grouped && change.treatment
                        ? <>Group test · {TREATMENT_LABEL[change.treatment]}</>
                        : (
                            <>
                                {CHANGE_TYPE_LABEL[change.changeType]}
                                {CHANGE_TYPE_HINT[change.changeType] ? <span className="text-zinc-400"> ({CHANGE_TYPE_HINT[change.changeType]})</span> : null}
                            </>
                        )}
                    {!grouped && change.pages[0]?.label ? ` · ${change.pages[0].label}` : ''}
                    {grouped ? ` · ${change.pages.length} pages` : ''}
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">{change.title}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <VerdictPill verdict={head.verdict} estimate={head.estimate} pct={headlinePct} />
                    {head.ready && <span className="text-xs text-muted-foreground">Latest: {head.days}-day check</span>}
                </div>
                <p className="mt-3 text-sm">{answerLine(change.kpi, impact)}</p>
                <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                    <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>{impact.causation}</span>
                </p>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                        <dt className="text-xs text-muted-foreground">Went live</dt>
                        <dd>{formatWentLive(change.liveAt)}</dd>
                    </div>
                    <div>
                        <dt className="text-xs text-muted-foreground">What we&apos;re watching</dt>
                        <dd>
                            {KPI_LABEL[change.kpi]}
                            {KPI_HINT[change.kpi] ? <span className="text-zinc-400"> ({KPI_HINT[change.kpi]})</span> : null}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-xs text-muted-foreground">{grouped ? 'Pages' : 'Page'}</dt>
                        <dd className="break-all">
                            {grouped
                                ? `${change.pages.length} pages, same change`
                                : change.pages.map(page => pageLine(page)).join(', ') || '—'}
                        </dd>
                    </div>
                </dl>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-medium">What changed</h3>
                <WordDiff before={change.beforeText} after={change.afterText} />
            </section>

            <TestProgressCard liveOn={change.liveOn} finalThrough={impact.finalThrough} />
            <CheckStepper change={change} impact={impact} today={asOf} />
            {grouped ? <GroupResults impact={impact} /> : <ResultsTable impact={impact} />}

            <section className="rounded-lg border border-border bg-card p-4">
                <ImpactChart
                    points={impact.series}
                    kpi={change.kpi}
                    liveOn={change.liveOn}
                    finalThrough={impact.finalThrough}
                    controlLabel={impact.controlLabel}
                    lowData={impact.headline.lowData}
                    markers={markers}
                    seriesName={grouped ? 'This group' : 'This page'}
                    subject={grouped ? 'group' : 'page'}
                />
            </section>

            <SearchTerms
                queries={queries}
                ready={head.ready}
                empty={searchTermsEmpty(impact.queries)}
                gaps={termsHaveGaps(impact.queries)}
                onToggle={toggle}
            />

            <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-medium">Other changes in this window</h3>
                {confounders.length === 0 ? (
                    <p className="mt-1 text-sm text-muted-foreground">None logged.</p>
                ) : (
                    <ul className="mt-2 space-y-2 text-sm">
                        {confounders.map(item => (
                            <li key={item.id}>
                                <button type="button" className="font-medium text-primary" onClick={() => onOpen(item.id)}>{item.title}</button>
                                <span className="text-muted-foreground"> · {CHANGE_TYPE_LABEL[item.changeType]} · {overlapLabel(item.overlap)} · {formatDayWithYear(item.liveOn)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">What happens next</h3>
                    <Button type="button" size="sm" variant="outline" className="change-log-no-print" onClick={() => setRevertOpen(true)}>How to undo</Button>
                </div>
                <p className="mt-1 text-sm">{nextStep(change.changeType, head.verdict)}</p>
                {revertOpen && (
                    <div className="mt-3 rounded-md bg-muted p-3 text-sm">
                        <p className="font-medium">Shows the saved steps. Doesn&apos;t change the live site.</p>
                        <p className="mt-1">{change.revertInstructions || 'No undo steps were saved.'}</p>
                        {change.backupReference && <p className="mt-1 text-muted-foreground">Saved copy of the old version: {change.backupReference}</p>}
                    </div>
                )}
            </section>

            <details className="change-log-record rounded-lg border border-border bg-card">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Record details</summary>
                <div className="space-y-3 border-t border-border px-4 py-3 text-sm">
                    <div>
                        <p className="text-xs text-muted-foreground">Approved by</p>
                        <p>{change.approvedByName}</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">Saved copy of the old version</p>
                        <p>{change.backupReference || '—'}</p>
                    </div>
                    {change.pages.map(page => (
                        <div key={page.url}>
                            <p className="text-xs text-muted-foreground">{page.label || 'Page'}</p>
                            <p className="break-all">{page.url}</p>
                            {page.cmsPageId && <p>Page id {page.cmsPageId}</p>}
                            {page.cmsWidgetId && <p>Section id {page.cmsWidgetId}</p>}
                        </div>
                    ))}
                    <div>
                        <p className="text-xs text-muted-foreground">Starting point</p>
                        <p>
                            {impact.baselineReady
                                ? `${impact.baseline.daysPresent} of ${impact.baseline.daysExpected} days before ${formatDay(change.liveOn)} are saved. Numbers are final through ${formatDay(impact.finalThrough)}.`
                                : "The 28 days before this change aren't saved yet."}
                        </p>
                        {baselineNote && <p className="mt-1">{baselineNote}</p>}
                        {impact.yoyNote && (
                            <p className="mt-2">
                                {impact.yoyNote}
                                {impact.yoy?.measured ? ` Last year: ${impact.yoy.clicks} clicks from Google, ${impact.yoy.impressions} times shown in Google.` : ''}
                            </p>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">{impact.sources.join(' · ')}. {SEARCH_CONSOLE_HINT}</p>
                </div>
            </details>

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Remove this change from the log?</DialogTitle>
                        <DialogDescription>This removes the saved record only. It doesn&apos;t change the live site.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={() => {
                                setConfirmOpen(false);
                                onRemove();
                            }}
                        >
                            Remove from log
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function CheckStepper({ change, impact, today }: { change: SeoChange; impact: ImpactModel; today: string }) {
    const schedule = checkSchedule(change.liveOn);
    const head = impact.headline;
    return (
        <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">When we check</h3>
                <p className="text-xs text-muted-foreground">
                    Today is {formatDayWithYear(today)}. Google&apos;s numbers are final through {formatDay(impact.finalThrough)}.
                </p>
            </div>
            <ol className="mt-4 grid gap-3 md:grid-cols-4">
                {impact.checkpoints.map((checkpoint, index) => {
                    const dates = schedule.find(item => item.days === checkpoint.days);
                    const current = head.ready && checkpoint.days === head.days;
                    const span = afterWindow(change.liveOn, checkpoint.days);
                    return (
                        <li
                            key={checkpoint.days}
                            data-check-days={checkpoint.days}
                            data-due={dates?.dueOn ?? ''}
                            data-ready={dates?.dataReadyOn ?? ''}
                            className={cn('rounded-lg border p-3', current ? 'border-zinc-900' : 'border-border')}
                        >
                            <div className="flex items-center gap-2">
                                <span className={cn(
                                    'flex size-6 items-center justify-center rounded-full text-xs font-semibold',
                                    checkpoint.ready ? 'bg-zinc-900 text-white' : 'border border-dashed border-zinc-300 text-zinc-500',
                                )}
                                >
                                    {index + 1}
                                </span>
                                <p className="text-sm font-medium">{checkpoint.days} days</p>
                                {dates && isTodayStep(schedule, dates.days, today) && <span className="text-xs font-medium text-amber-800">Today</span>}
                            </div>
                            {checkpoint.ready ? (
                                <div className="mt-2 space-y-1">
                                    <VerdictPill
                                        verdict={checkpoint.verdict}
                                        estimate={checkpoint.estimate}
                                        pct={headlineFields(checkpoint).headlinePct}
                                    />
                                    <p className="text-xs text-muted-foreground">{formatDay(span.start)}–{formatDay(span.end)}</p>
                                    <ComparisonLine checkpoint={checkpoint} />
                                </div>
                            ) : (
                                <p className="mt-2 text-sm font-medium">Not ready yet</p>
                            )}
                            {dates && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                    Due {formatDayWithYear(dates.dueOn)}
                                    <span className="block">Data ready ~{formatDay(dates.dataReadyOn)}</span>
                                </p>
                            )}
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}

function isTodayStep(schedule: readonly CheckDate[], days: number, today: string): boolean {
    if (!isIsoDay(today) || schedule.length === 0) return false;
    const upcoming = schedule.find(item => item.dueOn >= today) ?? schedule[schedule.length - 1];
    return upcoming.days === days;
}

function ComparisonLine({ checkpoint }: { checkpoint: CheckpointRead }) {
    const page = moveLabel(checkpoint.pageMove);
    if (!page) return null;
    const others = checkpoint.controlMode === 'none' ? null : moveLabel(checkpoint.controlMove);
    return (
        <p className="text-xs text-muted-foreground">
            {others ? `This page ${page}. Pages we didn't change ${others}.` : `This page ${page}.`}
        </p>
    );
}

function moveLabel(move: RateDelta | null): string | null {
    if (!move) return null;
    if (move.fromZero) return 'up from zero';
    if (move.helpful == null) return null;
    return formatHeadlinePct(move.helpful * 100);
}

function ResultsTable({ impact }: { impact: ImpactModel }) {
    const table = buildResultsTable(impact);
    const waiting = notReadyCopy(table.notReady);
    return (
        <section
            className="rounded-lg border border-border bg-card p-4"
            data-results-ready={table.ready ? 'true' : 'false'}
            data-low-data={table.lowData ? 'true' : 'false'}
        >
            <h3 className="text-sm font-medium">Before and after the change</h3>
            <p className="mt-1 text-xs text-muted-foreground">
                {table.ready
                    ? `Before is the daily average for the 28 days before this went live. After is the daily average for the ${table.days}-day check. Click rate and average position are for the whole period.`
                    : 'Before is the daily average for the 28 days before this went live. Click rate and average position are for the whole period.'}
            </p>
            {table.lowData && <p className="mt-2 text-sm text-amber-900">{EARLY_ESTIMATE_NOTE}</p>}
            {waiting && <p className="mt-2 text-sm">{waiting}</p>}
            <div className="insights-table-scroll mt-3">
                <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="text-xs text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 font-medium">Metric</th>
                            <th className="px-3 py-2 font-medium">Before</th>
                            <th className="px-3 py-2 font-medium">After</th>
                            <th className="px-3 py-2 font-medium">Change</th>
                        </tr>
                    </thead>
                    <tbody>
                        {table.rows.map(item => {
                            const tone = changeTone(item.change, item.lowerIsBetter);
                            return (
                                <tr
                                    key={item.id}
                                    data-metric={item.id}
                                    data-watched={item.watched ? 'true' : 'false'}
                                    className={cn('border-t border-border', item.watched && 'font-semibold')}
                                >
                                    <th scope="row" className="px-3 py-2 text-left font-medium">
                                        {item.watched && <span className="sr-only">Watching this. </span>}
                                        {item.label}
                                        {item.note && <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{item.note}</span>}
                                    </th>
                                    <td className="px-3 py-2 tabular-nums">{formatResultsValue(item.kind, item.before)}</td>
                                    <td className="px-3 py-2 tabular-nums">
                                        {table.ready ? formatResultsValue(item.kind, item.after) : 'Not ready yet'}
                                    </td>
                                    <td className={cn('px-3 py-2 tabular-nums', tone === 'good' && 'text-green-800', tone === 'bad' && 'text-red-800')}>
                                        {formatChangePercent(item.change)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function WordDiff({ before, after }: { before: string; after: string }) {
    const tokens = wordDiff(before, after);
    const removed = removedWords(tokens);
    const added = addedWords(tokens);
    if (!before.trim() && !after.trim()) {
        return <p className="mt-2 text-sm text-muted-foreground">No before or after text was saved.</p>;
    }
    return (
        <div className="mt-3 space-y-3 text-sm">
            <div>
                <p className="text-xs text-muted-foreground">Before</p>
                <p className="mt-1 leading-6">
                    {before.trim()
                        ? <DiffLine tokens={tokens.filter(token => token.kind === 'same' || token.kind === 'removed' || (token.kind === 'moved' && token.before))} side="before" />
                        : <span className="text-muted-foreground">Nothing saved for the old wording.</span>}
                </p>
            </div>
            <div>
                <p className="text-xs text-muted-foreground">After</p>
                <p className="mt-1 leading-6">
                    {after.trim()
                        ? <DiffLine tokens={tokens.filter(token => token.kind === 'same' || token.kind === 'added' || (token.kind === 'moved' && token.after))} side="after" />
                        : <span className="text-muted-foreground">Nothing saved for the new wording.</span>}
                </p>
            </div>
            {(removed.length > 0 || added.length > 0) && (
                <p className="flex flex-wrap items-center gap-2 text-xs">
                    {removed.length > 0 && (
                        <>
                            <span className="text-muted-foreground">Removed</span>
                            {removed.map((word, index) => (
                                <span key={`removed-${index}`} className="rounded bg-red-50 px-1.5 py-0.5 text-red-800 line-through">{word}</span>
                            ))}
                        </>
                    )}
                    {added.length > 0 && (
                        <>
                            <span className="text-muted-foreground">Added</span>
                            {added.map((word, index) => (
                                <span key={`added-${index}`} className="rounded bg-green-50 px-1.5 py-0.5 text-green-900">{word}</span>
                            ))}
                        </>
                    )}
                </p>
            )}
        </div>
    );
}

function DiffLine({ tokens, side }: { tokens: DiffToken[]; side: 'before' | 'after' }) {
    return (
        <>
            {tokens.map((token, index) => {
                const text = side === 'before' ? token.before : token.after;
                const marked = side === 'before' ? token.kind === 'removed' : token.kind === 'added';
                return (
                    <span
                        key={`${side}-${index}`}
                        className={marked
                            ? side === 'before'
                                ? 'text-red-800 line-through'
                                : 'rounded bg-green-100 px-0.5 text-green-900'
                            : undefined}
                    >
                        {index > 0 ? ' ' : ''}{text}
                    </span>
                );
            })}
        </>
    );
}

function pageLine(page: ChangePage): string {
    const path = pagePath(page.url, page.label);
    if (page.label && path !== page.label) return `${path} (${page.label})`;
    return path || page.url;
}

function ActionMenu({
    label,
    menuLabel,
    open,
    onOpenChange,
    children,
}: {
    label: ReactNode;
    menuLabel: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const focusEdge = useRef<'first' | 'last'>('first');
    useEffect(() => {
        if (!open) return;
        const items = menuItems(menuRef.current);
        (focusEdge.current === 'last' ? items[items.length - 1] : items[0])?.focus();
    }, [open]);
    useEffect(() => {
        if (!open) return;
        function onPointer(event: MouseEvent) {
            if (!ref.current?.contains(event.target as Node)) onOpenChange(false);
        }
        function onKey(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                onOpenChange(false);
                triggerRef.current?.focus();
            }
        }
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, onOpenChange]);

    function onTriggerKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        focusEdge.current = event.key === 'ArrowUp' ? 'last' : 'first';
        onOpenChange(true);
    }

    function onMenuKey(event: ReactKeyboardEvent<HTMLDivElement>) {
        const items = menuItems(menuRef.current);
        if (items.length === 0) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            onOpenChange(false);
            triggerRef.current?.focus();
            return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home'
            ? 0
            : event.key === 'End'
                ? items.length - 1
                : event.key === 'ArrowUp'
                    ? (current <= 0 ? items.length - 1 : current - 1)
                    : (current < 0 || current >= items.length - 1 ? 0 : current + 1);
        items[next]?.focus();
    }

    return (
        <div ref={ref} className="relative">
            <Button
                ref={triggerRef}
                type="button"
                variant="outline"
                size="sm"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={menuLabel}
                data-menu={menuLabel === 'Download' ? 'download' : 'more'}
                onClick={() => {
                    focusEdge.current = 'first';
                    onOpenChange(!open);
                }}
                onKeyDown={onTriggerKey}
            >
                {label}
            </Button>
            {open && (
                <div
                    ref={menuRef}
                    role="menu"
                    aria-label={menuLabel}
                    className="absolute right-0 z-30 mt-1 min-w-56 rounded-md border border-border bg-card p-1 shadow-md"
                    onKeyDown={onMenuKey}
                >
                    {children}
                </div>
            )}
        </div>
    );
}

function menuItems(menu: HTMLElement | null): HTMLButtonElement[] {
    return [...menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []];
}

function MenuItem({
    children,
    onClick,
    destructive = false,
}: {
    children: ReactNode;
    onClick: () => void;
    destructive?: boolean;
}) {
    return (
        <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={cn('block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-muted', destructive && 'font-medium text-red-700')}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SearchTerms({
    queries,
    ready,
    empty,
    gaps,
    onToggle,
}: {
    queries: QueryCompare[];
    ready: boolean;
    empty: 'none' | 'unmeasured' | null;
    gaps: boolean;
    onToggle: (key: SortKey) => void;
}) {
    return (
        <section className="rounded-lg border border-border bg-card" data-terms-empty={empty ?? 'false'}>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
                <h3 className="text-sm font-medium">Search terms people used</h3>
                <p className="text-xs text-muted-foreground">Only some terms. Google hides some searches.</p>
            </div>
            {empty ? (
                <p className="px-4 pb-4 text-sm text-muted-foreground">{TERMS_EMPTY_COPY[empty]}</p>
            ) : (
                <div className="insights-table-scroll">
                    <table className="w-full min-w-[640px] text-left text-sm">
                        <thead className="text-xs text-muted-foreground">
                            <tr>
                                <SortHead label="Search term" onClick={() => onToggle('query')} />
                                <SortHead label="Clicks from Google" onClick={() => onToggle('clicks')} />
                                <SortHead label="Times shown in Google" onClick={() => onToggle('impressions')} />
                                <SortHead label="Average Google position" onClick={() => onToggle('position')} />
                            </tr>
                        </thead>
                        <tbody>
                            {queries.map(query => (
                                <tr key={query.query} className="border-t border-border">
                                    <td className="px-4 py-2">{query.query}</td>
                                    <td className="px-4 py-2 tabular-nums">{formatTermValue(query.beforeClicks)} → {formatTermValue(query.afterClicks)}</td>
                                    <td className="px-4 py-2 tabular-nums">{formatTermValue(query.beforeImpressions)} → {formatTermValue(query.afterImpressions)}</td>
                                    <td className="px-4 py-2 tabular-nums">{formatTermValue(query.beforePosition)} → {formatTermValue(query.afterPosition)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {!empty && !ready && (
                <p className="px-4 py-3 text-xs text-muted-foreground">The numbers after this went live aren&apos;t ready yet. {TERMS_MISSING_NOTE}</p>
            )}
            {!empty && ready && gaps && (
                <p className="px-4 py-3 text-xs text-muted-foreground">{TERMS_MISSING_NOTE}</p>
            )}
        </section>
    );
}

function SortHead({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <th className="px-4 py-2 font-medium">
            <button type="button" onClick={onClick} className="hover:text-foreground">{label}</button>
        </th>
    );
}

function compareDelta(a: number | null, b: number | null, dir: 1 | -1): number {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return (a - b) * dir;
}

function sortQueries(rows: QueryCompare[], sort: { key: SortKey; dir: 'asc' | 'desc' }): QueryCompare[] {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        const value = sort.key === 'query'
            ? a.query.localeCompare(b.query) * dir
            : sort.key === 'clicks'
                ? compareDelta(a.clicksDelta, b.clicksDelta, dir)
                : sort.key === 'impressions'
                    ? compareDelta(a.impressionsDelta, b.impressionsDelta, dir)
                    : compareDelta(a.positionDelta, b.positionDelta, dir);
        return value;
    });
}

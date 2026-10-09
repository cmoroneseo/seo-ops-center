'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
    closeMonthName,
    filterCloseBoard,
    moveSelection,
    type CloseBoardView,
    type CloseCardView,
    type CloseColumn,
    type CloseStatusFilter,
} from '@/lib/reports/close-view';

const COLUMNS: { id: CloseColumn; label: string }[] = [
    { id: 'blocked', label: 'Blocked' },
    { id: 'ready', label: 'Ready' },
    { id: 'approved', label: 'Approved & scheduled' },
    { id: 'sent', label: 'Sent' },
];

const STATE_LABEL: Record<string, string> = {
    draft: 'Draft',
    ready_for_review: 'Ready',
    approved: 'Approved',
    scheduled: 'Scheduled',
    sent: 'Sent',
};

function approveEnabled(card: CloseCardView, note: string, role: CloseBoardView['actorRole']): boolean {
    if (role === 'viewer') return false;
    if (card.ownerApprovalPending) return card.canApprove;
    const needsNote = card.checks.some(check => (check.id === 'no_work' || check.id === 'gsc_real_zero') && !check.ok);
    const otherBlocking = card.checks.some(check => check.severity === 'blocking' && !check.ok && check.id !== 'no_work' && check.id !== 'gsc_real_zero');
    if (otherBlocking) return false;
    if (needsNote) return note.trim().length > 0;
    return card.canApprove;
}

export function CloseBoard({
    board,
    busy,
    error,
    onApprove,
    onSchedule,
}: {
    board: CloseBoardView;
    busy: boolean;
    error: string;
    onApprove: (reportId: string, note: string) => void;
    onSchedule: (reportId: string) => void;
}) {
    const [query, setQuery] = useState('');
    const [managerId, setManagerId] = useState('all');
    const [status, setStatus] = useState<CloseStatusFilter>('all');
    const [waitingOpen, setWaitingOpen] = useState(true);
    const [showAllWaiting, setShowAllWaiting] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const listRef = useRef<HTMLDivElement>(null);

    const visible = useMemo(
        () => filterCloseBoard(board, { query, managerId, status }),
        [board, query, managerId, status],
    );
    const cards = useMemo(
        () => COLUMNS.flatMap(column => visible.columns[column.id].map(card => ({ id: card.reportId, column: column.id, card }))),
        [visible],
    );
    const selected = cards.find(item => item.id === selectedId)?.card
        ?? cards[0]?.card
        ?? null;

    useEffect(() => {
        if (selected && selected.reportId !== selectedId) setSelectedId(selected.reportId);
    }, [selected, selectedId]);

    useEffect(() => {
        if (!selectedId) return;
        document.getElementById(`close-card-${selectedId}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [selectedId]);

    const waitingCount = visible.noSearchConsole.length + visible.pendingDrafts.length;
    const shownWaiting = showAllWaiting ? visible.noSearchConsole : visible.noSearchConsole.slice(0, 8);
    const needsNote = selected?.checks.some(check => (check.id === 'no_work' || check.id === 'gsc_real_zero') && !check.ok) ?? false;

    function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
        const next = moveSelection(cards, selected?.reportId ?? null, event.key);
        if (!next || next === selected?.reportId) return;
        event.preventDefault();
        setSelectedId(next);
        setNote('');
    }

    return (
        <div className="flex h-full min-h-0 flex-col gap-3 p-4 lg:p-6" data-close-board="">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-2xl font-semibold tracking-tight">{board.title}</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {visible.meta}
                        <span className="hidden sm:inline"> · Drafts appear once a client’s {board.monthName} GSC days are final</span>
                    </p>
                </div>
                <div className="flex items-center gap-2 text-sm">
                    {board.previousMonth && (
                        <Link href={`/reports/close?month=${board.previousMonth}`} className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground">
                            {closeMonthName(board.previousMonth)}
                        </Link>
                    )}
                    <span className="rounded-md bg-card px-3 py-1.5 font-medium">{board.monthName}{board.inProgress ? ' · in progress' : ''}</span>
                    {board.nextMonth && (
                        <Link href={`/reports/close?month=${board.nextMonth}`} className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground">
                            {closeMonthName(board.nextMonth)}{board.nextInProgress ? ' · in progress' : ''}
                        </Link>
                    )}
                    <Link href="/reports" className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground">Builder</Link>
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Search clients"
                    aria-label="Search clients"
                    className="h-9 min-w-40 flex-1 rounded-md border border-border bg-card px-3 text-sm"
                />
                <select
                    value={managerId}
                    onChange={event => setManagerId(event.target.value)}
                    aria-label="Account manager"
                    className="h-9 rounded-md border border-border bg-card px-2 text-sm"
                >
                    <option value="all">All account managers</option>
                    {board.managers.map(manager => (
                        <option key={manager.id} value={manager.id}>{manager.name}</option>
                    ))}
                </select>
                <select
                    value={status}
                    onChange={event => setStatus(event.target.value as CloseStatusFilter)}
                    aria-label="Status"
                    className="h-9 rounded-md border border-border bg-card px-2 text-sm"
                >
                    <option value="all">All statuses</option>
                    <option value="blocked">Blocked</option>
                    <option value="ready">Ready</option>
                    <option value="approved">Approved & scheduled</option>
                    <option value="sent">Sent</option>
                    <option value="waiting">Waiting on data</option>
                </select>
            </div>

            {board.banner && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm" role="status">
                    <p>{board.banner.message}</p>
                    <Link href={board.banner.addContactsHref} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                        Add contacts
                    </Link>
                </div>
            )}

            <section className="rounded-lg border border-border bg-card">
                <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                    aria-expanded={waitingOpen}
                    aria-controls="close-waiting"
                    onClick={() => setWaitingOpen(open => !open)}
                >
                    <span className="font-medium">Waiting on data · {waitingCount}</span>
                    <span className="text-xs text-muted-foreground">{waitingOpen ? 'Hide' : 'Show'}</span>
                </button>
                {waitingOpen && (
                    <div id="close-waiting" className="space-y-3 border-t border-border px-3 py-3">
                        <div>
                            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">No Search Console</h2>
                            <p className="mt-1 text-xs text-muted-foreground">
                                No Search Console connected, so no draft gets created.
                                {visible.hoursLoggedWithoutConsole > 0 ? ` ${visible.hoursLoggedWithoutConsole} of them still logged hours in ${board.monthName}.` : ''}
                            </p>
                            <ul className="mt-2 flex flex-wrap gap-2">
                                {shownWaiting.map(client => (
                                    <li key={client.clientId} className="flex items-center gap-2 rounded-full border border-border px-2 py-1 text-xs">
                                        <span>{client.clientName}</span>
                                        <span className="text-muted-foreground">{client.hoursLabel}</span>
                                        <Link href={client.connectHref} className="text-primary">Connect</Link>
                                    </li>
                                ))}
                                {visible.noSearchConsole.length === 0 && <li className="text-xs text-muted-foreground">No clients in this group.</li>}
                            </ul>
                            {visible.noSearchConsole.length > 8 && (
                                <button type="button" className="mt-2 text-xs text-primary" onClick={() => setShowAllWaiting(value => !value)}>
                                    {showAllWaiting ? 'Show fewer' : `View all ${visible.noSearchConsole.length}`}
                                </button>
                            )}
                        </div>
                        {visible.pendingDrafts.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                                No drafts yet for {visible.pendingDrafts.length} connected {visible.pendingDrafts.length === 1 ? 'client' : 'clients'}. Drafts appear once a client’s {board.monthName} days are final, usually about 3 days after month end.
                            </p>
                        )}
                        <div>
                            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tracker error (doesn’t block)</h2>
                            <ul className="mt-2 flex flex-wrap gap-2">
                                {visible.trackerErrors.map(client => (
                                    <li key={client.clientId}>
                                        <button
                                            type="button"
                                            className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground"
                                            onClick={() => client.reportId && setSelectedId(client.reportId)}
                                        >
                                            {client.clientName} · Ahrefs error
                                        </button>
                                    </li>
                                ))}
                                {visible.trackerErrors.length === 0 && <li className="text-xs text-muted-foreground">No tracker errors.</li>}
                            </ul>
                        </div>
                    </div>
                )}
            </section>

            {!board.monthHasDrafts && (
                <p className="text-sm text-muted-foreground">
                    No drafts yet. Drafts appear once a client’s {board.monthName} days are final, usually about 3 days after month end.
                </p>
            )}

            <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row" onKeyDown={onKeyDown}>
                <div
                    ref={listRef}
                    role="listbox"
                    aria-label="Month close reports"
                    aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                    tabIndex={0}
                    className="flex min-h-64 min-w-0 flex-1 gap-3 overflow-x-auto lg:min-h-0"
                    data-close-columns=""
                >
                    {COLUMNS.map(column => (
                        <section key={column.id} className="flex w-64 shrink-0 flex-col min-h-0" aria-label={`${column.label}, ${visible.columns[column.id].length}`}>
                            <h2 className="sticky top-0 z-10 bg-background pb-2 text-sm font-semibold">
                                {column.label} <span className="text-muted-foreground">{visible.columns[column.id].length}</span>
                            </h2>
                            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                                {visible.columns[column.id].map(card => {
                                    const active = selected?.reportId === card.reportId;
                                    return (
                                        <button
                                            key={card.reportId}
                                            id={`close-card-${card.reportId}`}
                                            type="button"
                                            role="option"
                                            aria-selected={active}
                                            onClick={() => { setSelectedId(card.reportId); setNote(''); }}
                                            className={`rounded-lg border bg-card p-3 text-left ${active ? 'border-primary ring-2 ring-primary' : 'border-border'}`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold">{card.initials}</span>
                                                <span className="min-w-0">
                                                    <span className="block truncate text-sm font-medium">{card.clientName}</span>
                                                    <span className="block truncate text-[11px] text-muted-foreground">{card.managerName} · {card.hoursLabel} · {card.tasksLabel}</span>
                                                </span>
                                            </div>
                                            {card.hoursRatio != null && (
                                                <span className="mt-2 block h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                                                    <span className="block h-full bg-primary" style={{ width: `${Math.round(card.hoursRatio * 100)}%` }} />
                                                </span>
                                            )}
                                            <span className="mt-2 flex flex-wrap gap-1 text-[10px]">
                                                {card.gscFinal && <span className="rounded-full border border-border px-1.5 py-0.5">GSC</span>}
                                                {card.blockingCount > 0 && <span className="rounded-full border border-destructive/40 px-1.5 py-0.5 text-destructive">{card.blockingCount} blocking</span>}
                                                {card.warnCount > 0 && <span className="rounded-full border border-amber-500/40 px-1.5 py-0.5 text-amber-500">{card.warnCount} warn</span>}
                                            </span>
                                        </button>
                                    );
                                })}
                                {visible.columns[column.id].length === 0 && (
                                    <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                                        {column.id === 'approved' && 'Nothing approved yet. Approved drafts lock their data snapshot and move here with a send time.'}
                                        {column.id === 'sent' && `No ${board.monthName} reports sent.`}
                                        {(column.id === 'blocked' || column.id === 'ready') && 'No reports in this column.'}
                                    </p>
                                )}
                            </div>
                        </section>
                    ))}
                </div>

                <aside className="w-full shrink-0 overflow-y-auto rounded-lg border border-border bg-card p-4 lg:sticky lg:top-0 lg:max-h-full lg:w-80" aria-label="Pre-send checks">
                    {selected ? (
                        <div className="space-y-3">
                            <div>
                                <h2 className="text-base font-semibold">{selected.clientName}</h2>
                                <p className="text-xs text-muted-foreground">{board.monthName} report · {STATE_LABEL[selected.state] ?? selected.state}</p>
                            </div>
                            <p className="text-xs">
                                {selected.gscFinal ? <span className="text-foreground">Data final</span> : <span className="text-amber-500">Search data not final</span>}
                                {selected.blockingCount > 0 ? ` · ${selected.blockingCount} blocking` : ''}
                            </p>
                            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pre-send checks</h3>
                            <ul className="space-y-2">
                                {selected.checks.filter(check => !check.ok || check.id === 'month_final').map(check => (
                                    <li key={`${check.id}-${check.message}`} className="text-xs">
                                        <span className={check.ok ? 'text-foreground' : check.severity === 'blocking' ? 'text-destructive' : 'text-amber-500'}>
                                            {check.ok ? 'Done' : check.severity === 'blocking' ? 'Blocking' : 'Warning'}
                                        </span>
                                        <span className="text-muted-foreground"> · </span>
                                        {check.message}
                                    </li>
                                ))}
                                {!selected.gbpConnected && <li className="text-xs text-muted-foreground">Business Profile isn’t connected. Call-button taps will show —.</li>}
                                {!selected.ga4Connected && <li className="text-xs text-muted-foreground">GA4 isn’t connected. Form fills will show —.</li>}
                            </ul>
                            {needsNote && (
                                <label className="block text-xs text-muted-foreground">
                                    Note for What we did
                                    <textarea
                                        value={note}
                                        onChange={event => setNote(event.target.value)}
                                        rows={3}
                                        maxLength={2000}
                                        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                                    />
                                </label>
                            )}
                            {error && <p className="text-xs text-destructive">{error}</p>}
                            <div className="flex flex-wrap gap-2">
                                <Link href={selected.previewHref} className="rounded-md border border-border px-3 py-1.5 text-xs">
                                    Preview report
                                </Link>
                                <button
                                    type="button"
                                    disabled={busy || !approveEnabled(selected, note, board.actorRole)}
                                    onClick={() => onApprove(selected.reportId, note)}
                                    className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
                                >
                                    {selected.ownerApprovalPending ? 'Owner approval' : 'Approve'}
                                </button>
                                <button
                                    type="button"
                                    disabled={busy || !selected.canSchedule}
                                    onClick={() => onSchedule(selected.reportId)}
                                    className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50"
                                >
                                    Schedule
                                </button>
                            </div>
                            {selected.state === 'draft' && needsNote && (
                                <p className="text-[11px] text-muted-foreground">Approve stays off until {board.monthName} work is logged or you add a written note.</p>
                            )}
                            {selected.schedulingWaitsForRecipient && selected.state === 'approved' && (
                                <p className="text-[11px] text-muted-foreground">Scheduling waits for a recipient.</p>
                            )}
                            {selected.scheduledFor && (
                                <p className="text-[11px] text-muted-foreground">
                                    Scheduled {new Date(selected.scheduledFor).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} PT.
                                </p>
                            )}
                            <p className="text-[11px] text-muted-foreground">Nothing is emailed from this board.</p>
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">Select a report to review its checks.</p>
                    )}
                </aside>
            </div>
        </div>
    );
}

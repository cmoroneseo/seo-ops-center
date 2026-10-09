/**
 * Client-safe close-board view. This file stays free of node:crypto so the
 * board component can import it in the browser bundle.
 */

import type { PresendCheck } from './presend-checks';
import type { ReviewState } from './workflow';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const CLOSE_COLUMNS = ['blocked', 'ready', 'approved', 'sent'] as const;

export type CloseColumn = typeof CLOSE_COLUMNS[number];
export type CloseStatusFilter = 'all' | CloseColumn | 'waiting';

export function closeMonthName(month: string): string {
    const match = MONTH.exec(month);
    if (!match) return month;
    return MONTH_NAMES[Number(match[2]) - 1] ?? month;
}

export function closeTitle(month: string): string {
    return `Reports · ${closeMonthName(month)} close`;
}

export function closeMeta(active: number, drafts: number, waiting: number): string {
    const clients = active === 1 ? 'client' : 'clients';
    const draftWord = drafts === 1 ? 'draft' : 'drafts';
    return `${active} ${clients} on monthly reports · ${drafts} ${draftWord} · ${waiting} waiting on data`;
}

export function shiftMonth(month: string, delta: number): string | null {
    const match = MONTH.exec(month);
    if (!match || !Number.isInteger(delta)) return null;
    const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + delta;
    if (index < 0) return null;
    const year = Math.floor(index / 12);
    const monthIndex = index % 12;
    if (year < 2000 || year > 2100) return null;
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

export interface CloseCardView {
    reportId: string;
    clientId: string;
    clientName: string;
    initials: string;
    managerId: string;
    managerName: string;
    searchText: string;
    hoursLabel: string;
    hoursRatio: number | null;
    tasksLabel: string;
    state: ReviewState;
    column: CloseColumn;
    blockingCount: number;
    warnCount: number;
    trackerWarning: boolean;
    schedulingWaitsForRecipient: boolean;
    ownerApprovalPending: boolean;
    gscFinal: boolean;
    ga4Connected: boolean;
    gbpConnected: boolean;
    checks: PresendCheck[];
    canApprove: boolean;
    canSchedule: boolean;
    previewHref: string;
    scheduledFor: string | null;
}

export interface CloseWaitingView {
    clientId: string;
    clientName: string;
    managerId: string;
    searchText: string;
    hoursLabel: string;
    loggedHours: number;
    connectHref: string;
}

export interface CloseTrackerView {
    clientId: string;
    clientName: string;
    managerId: string;
    searchText: string;
    reportId: string | null;
}

export interface CloseBoardView {
    month: string;
    monthName: string;
    title: string;
    meta: string;
    actorRole: 'owner' | 'admin' | 'member' | 'viewer';
    activeClients: number;
    drafts: number;
    waitingOnData: number;
    monthHasDrafts: boolean;
    banner: { message: string; addContactsHref: string } | null;
    noSearchConsole: CloseWaitingView[];
    pendingDrafts: CloseWaitingView[];
    trackerErrors: CloseTrackerView[];
    hoursLoggedWithoutConsole: number;
    columns: Record<CloseColumn, CloseCardView[]>;
    managers: { id: string; name: string }[];
    previousMonth: string | null;
    nextMonth: string | null;
    nextInProgress: boolean;
    inProgress: boolean;
}

export interface CloseFilter {
    query: string;
    managerId: string;
    status: CloseStatusFilter;
}

function matches(row: { managerId: string; searchText: string }, filter: CloseFilter): boolean {
    if (filter.managerId !== 'all' && row.managerId !== filter.managerId) return false;
    const query = filter.query.trim().toLowerCase();
    return query.length === 0 || row.searchText.toLowerCase().includes(query);
}

export function filterCloseBoard(board: CloseBoardView, filter: CloseFilter): CloseBoardView {
    const status = filter.status;
    const columns: Record<CloseColumn, CloseCardView[]> = { blocked: [], ready: [], approved: [], sent: [] };
    for (const column of CLOSE_COLUMNS) {
        if (status !== 'all' && status !== column) continue;
        columns[column] = board.columns[column].filter(card => matches(card, filter));
    }
    const showWaiting = status === 'all' || status === 'waiting';
    const noSearchConsole = showWaiting ? board.noSearchConsole.filter(row => matches(row, filter)) : [];
    const pendingDrafts = showWaiting ? board.pendingDrafts.filter(row => matches(row, filter)) : [];
    const visibleIds = new Set<string>([
        ...CLOSE_COLUMNS.flatMap(column => columns[column].map(card => card.clientId)),
        ...noSearchConsole.map(row => row.clientId),
        ...pendingDrafts.map(row => row.clientId),
    ]);
    const trackerErrors = status === 'all' || status === 'blocked' || status === 'ready' || status === 'approved' || status === 'sent'
        ? board.trackerErrors.filter(row => matches(row, filter) && (row.reportId ? visibleIds.has(row.clientId) : false))
        : [];
    const drafts = columns.blocked.length + columns.ready.length;
    const waitingOnData = noSearchConsole.length + pendingDrafts.length;
    return {
        ...board,
        columns,
        noSearchConsole,
        pendingDrafts,
        trackerErrors,
        hoursLoggedWithoutConsole: noSearchConsole.filter(row => row.loggedHours > 0).length,
        activeClients: visibleIds.size,
        drafts,
        waitingOnData,
        meta: closeMeta(visibleIds.size, drafts, waitingOnData),
    };
}

export interface CloseCardRef {
    id: string;
    column: CloseColumn;
}

/** Arrow keys move between visible report cards. Empty columns are skipped. */
export function moveSelection(cards: readonly CloseCardRef[], currentId: string | null, key: string): string | null {
    if (cards.length === 0) return null;
    if (key === 'Home') return cards[0].id;
    if (key === 'End') return cards[cards.length - 1].id;
    const current = currentId ? cards.find(card => card.id === currentId) ?? null : null;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
        const column = current?.column ?? 'blocked';
        const inColumn = cards.filter(card => card.column === column);
        const pool = inColumn.length > 0 ? inColumn : cards;
        const position = current ? pool.findIndex(card => card.id === current.id) : -1;
        if (position < 0) return pool[0].id;
        const next = key === 'ArrowDown' ? Math.min(pool.length - 1, position + 1) : Math.max(0, position - 1);
        return pool[next].id;
    }
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
        const column = current?.column ?? 'blocked';
        const start = CLOSE_COLUMNS.indexOf(column);
        const direction = key === 'ArrowRight' ? 1 : -1;
        const rowInColumn = cards.filter(card => card.column === column);
        const row = Math.max(0, current ? rowInColumn.findIndex(card => card.id === current.id) : 0);
        for (let step = 1; step <= CLOSE_COLUMNS.length; step += 1) {
            const nextColumn = CLOSE_COLUMNS[(start + direction * step + CLOSE_COLUMNS.length) % CLOSE_COLUMNS.length];
            const inColumn = cards.filter(card => card.column === nextColumn);
            if (inColumn.length === 0) continue;
            return inColumn[Math.min(row, inColumn.length - 1)].id;
        }
    }
    return currentId;
}

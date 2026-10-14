import type { ClientAgreement } from './types';
import { agreementPeriod, formatHourAmount, formatHourQuota } from './logic';

/** The phase an operator can store. Month numbers are open-ended. */
export type StoredPhase = 'onboarding' | `month_${number}`;

export const AGREEMENT_NOT_RECORDED = 'Agreement not recorded';
export const AGREEMENT_HISTORY_UNAVAILABLE = 'Agreement history unavailable';
const PHASE_RE = /^month_([1-9][0-9]*)$/;
const COMPLETE = new Set(['done', 'approved']);

export function isStoredPhase(value: unknown): value is StoredPhase {
    return value === 'onboarding' || (typeof value === 'string' && PHASE_RE.test(value));
}

export function phaseRank(phase: StoredPhase): number {
    return phase === 'onboarding' ? 0 : Number(phase.slice('month_'.length));
}

/** "Slipped · was Month N" or "Slipped · was Onboarding". */
export function slipLabel(was: StoredPhase): string {
    return was === 'onboarding' ? 'Slipped · was Onboarding' : `Slipped · was Month ${phaseRank(was)}`;
}

function yearMonth(date: string): number {
    const [year, month] = date.slice(0, 7).split('-').map(Number);
    return year * 12 + month;
}

/**
 * Month index from the anchor month. 1 is the calendar month that contains the
 * anchor, including days before the anchor day. A date in an earlier month is
 * not given an index; phaseAt maps that to onboarding.
 *
 * phaseIndex(anchor, date) = (year * 12 + month) − (anchorYear * 12 + anchorMonth) + 1
 */
export function phaseIndex(anchor: string, date: string): number {
    return yearMonth(date) - yearMonth(anchor) + 1;
}

export function phaseAt(anchor: string | null, date: string | null | undefined): StoredPhase | null {
    if (!anchor || !date || !/^\d{4}-\d{2}/.test(date)) return null;
    const index = phaseIndex(anchor, date);
    if (index < 1) return 'onboarding';
    return `month_${index}`;
}

/** Calendar month of a stored month phase. Onboarding is not a month. */
export function phaseCalendarMonth(anchor: string, phase: StoredPhase): string | null {
    if (phase === 'onboarding') return null;
    const index = yearMonth(anchor) + phaseRank(phase) - 1;
    const zero = index - 1;
    const year = Math.floor(zero / 12);
    const month = (zero % 12) + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
}

function isoDate(year: number, monthIndex: number, day: number): string {
    return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

/**
 * Inclusive last day of a phase window. Onboarding ends the day before the
 * anchor month. Month N is that whole calendar month, including days before
 * the anchor day in Month 1.
 */
export function phaseWindowEnd(anchor: string, phase: StoredPhase): string {
    const [year, monthNumber] = anchor.slice(0, 7).split('-').map(Number);
    if (phase === 'onboarding') return isoDate(year, monthNumber - 1, 0);
    const month = phaseCalendarMonth(anchor, phase);
    if (!month) return anchor.slice(0, 10);
    const [phaseYear, phaseMonth] = month.split('-').map(Number);
    return isoDate(phaseYear, phaseMonth, 0);
}

/** True once today is after the phase window. The window's last day still counts. */
export function phaseWindowPassed(anchor: string, phase: StoredPhase, today: string): boolean {
    const day = today.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) && day > phaseWindowEnd(anchor, phase);
}

export function calendarMonthLabel(month: string): string {
    const [year, monthNumber] = month.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

export function shortDueLabel(due: string | null | undefined): string {
    if (!due) return 'no date';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${due.slice(0, 10)}T12:00:00Z`));
}

/**
 * Root agreement start. Renewals, amendments, and supersedes extend this clock.
 * The walk follows previous_id, including a cancelled ancestor, so Month 1 does
 * not restart. A history with no live row has no anchor.
 */
export function phaseAnchor(agreements: ClientAgreement[]): string | null {
    const live = agreements.filter(item => !item.cancelledAt);
    if (!live.length) return null;
    const byId = new Map(agreements.map(item => [item.id, item]));
    const rootOf = (agreement: ClientAgreement): ClientAgreement => {
        const seen = new Set<string>();
        let current = agreement;
        while (current.previousId && byId.has(current.previousId) && !seen.has(current.id)) {
            seen.add(current.id);
            current = byId.get(current.previousId)!;
        }
        return current;
    };
    const roots = live.map(rootOf);
    const initials = roots.filter(item => item.kind === 'initial' || !item.previousId);
    const pool = (initials.length ? initials : roots).sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.id.localeCompare(b.id));
    return pool[0]?.startsOn ?? null;
}

export interface PhasePlacement {
    column: string;
    slipped: boolean;
    slipLabel: string | null;
    dueDate: string | null;
}

/**
 * Display phase. A lock wins. Otherwise the column is derived from the due
 * date against the root agreement start — including tasks whose plan_phase is
 * still null from before migration 088. That derivation is display-only and
 * must not be written back. With no anchor, the column stays a calendar month
 * and never pretends to be Month 1. An open task whose due date is past its
 * phase window rolls into the current column and keeps the original due date.
 */
export function displayPhase(input: {
    anchor: string | null;
    today: string;
    dueDate?: string | null;
    status?: string | null;
    planPhase?: string | null;
    locked?: boolean;
}): PhasePlacement {
    const due = input.dueDate?.slice(0, 10) || null;
    if (input.locked && isStoredPhase(input.planPhase)) {
        return { column: input.planPhase, slipped: false, slipLabel: null, dueDate: due };
    }
    if (!due) return { column: 'needs_date', slipped: false, slipLabel: null, dueDate: null };
    const scheduled = input.anchor ? phaseAt(input.anchor, due) : null;
    if (!input.anchor || !scheduled) return { column: due.slice(0, 7), slipped: false, slipLabel: null, dueDate: due };
    const current = phaseAt(input.anchor, input.today) ?? 'onboarding';
    const open = !input.status || !COMPLETE.has(input.status);
    if (open && phaseWindowPassed(input.anchor, scheduled, input.today)) {
        return { column: current, slipped: true, slipLabel: slipLabel(scheduled), dueDate: due };
    }
    return { column: scheduled, slipped: false, slipLabel: null, dueDate: due };
}

/**
 * Agreements for the roadmap. A failed refresh must not drop a history the
 * client page already loaded, or every unphased task falls back to a calendar
 * month and never shows a slipped label.
 */
export function roadmapAgreements(input: {
    fetched: ClientAgreement[] | null;
    failed: boolean;
    known: ClientAgreement[] | null | undefined;
}): { agreements: ClientAgreement[] | null; failed: boolean } {
    if (input.fetched) return { agreements: input.fetched, failed: false };
    const known = input.known?.length ? input.known : null;
    if (known) return { agreements: known, failed: false };
    return { agreements: null, failed: input.failed };
}

/** Written when a due date is scheduled. A pin that matches the due date stays unlocked. */
export function phaseWrite(anchor: string | null, dueDate: string | null, pinned: string | null): { planPhase: string | null; planPhaseLocked: boolean } {
    const fromDue = phaseAt(anchor, dueDate);
    if (pinned && isStoredPhase(pinned) && pinned !== fromDue) return { planPhase: pinned, planPhaseLocked: true };
    return { planPhase: fromDue, planPhaseLocked: false };
}

export interface PhaseTask {
    id: string;
    title: string;
    status: string;
    dueDate?: string | null;
    estimatedHours?: number | null;
    planPhase?: string | null;
    planPhaseLocked?: boolean;
    agreementId?: string | null;
    commitmentId?: string | null;
    assigneeIds?: string[];
}

export interface PhaseWork {
    id: string;
    title: string;
    ignored?: boolean;
    done?: boolean;
    onboardingChecklist?: boolean;
    dueDate?: string | null;
    owner?: string;
    task?: PhaseTask | null;
}

export interface PhaseLog {
    taskId?: string | null;
    date: string;
    hours: number;
    countsTowardBudget: boolean;
}

export interface TimelineCard {
    id: string;
    title: string;
    owner: string;
    dueLabel: string;
    dueDate: string | null;
    slipped: boolean;
    slipLabel: string | null;
    done: boolean;
}

export interface TimelineCommitment {
    id: string;
    title: string;
    plannedLabel: string;
    deliveredLabel: string;
    mismatch: boolean;
}

export interface TimelineColumn {
    key: string;
    title: string;
    meta: string;
    agreementLabel: string | null;
    cards: TimelineCard[];
    commitments: TimelineCommitment[];
}

export interface TimelineModel {
    pending: boolean;
    notice: string | null;
    columns: TimelineColumn[];
}

export interface MonthBoard {
    needsDate: string[];
    due: string[];
    slipped: Array<{ id: string; slipLabel: string }>;
}

interface Placed {
    column: string;
    card: TimelineCard;
    task: PhaseTask | null;
    month: string | null;
}

function shiftMonth(month: string, delta: number): string {
    const [year, monthNumber] = month.split('-').map(Number);
    const zero = year * 12 + (monthNumber - 1) + delta;
    return `${Math.floor(zero / 12)}-${String((zero % 12) + 1).padStart(2, '0')}`;
}

function daysInMonth(month: string): number {
    const [year, monthNumber] = month.split('-').map(Number);
    return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

export function plannedLabel(estimates: Array<number | null | undefined>, hide: boolean): string {
    if (hide) return '—';
    const known = estimates.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const missing = estimates.length - known.length;
    if (!estimates.length) return '—';
    const amount = known.length ? `${formatHourAmount(known.reduce((sum, value) => sum + value, 0))}h` : '—';
    if (!missing) return amount;
    return `${amount} · ${missing === 1 ? '1 needs an estimate' : `${missing} need an estimate`}`;
}

export function deliveredLabel(hours: number | null, outside: boolean): string {
    if (outside) return '— · outside an agreement';
    if (hours == null || !Number.isFinite(hours)) return '—';
    return `${(Math.round(hours * 10) / 10).toFixed(1)}h`;
}

function deliveredHours(logs: PhaseLog[] | null, failed: boolean, taskIds: Set<string>, month: string): number | null {
    if (failed || !logs) return null;
    return logs.filter(log => log.countsTowardBudget && !!log.taskId && taskIds.has(log.taskId) && log.date.slice(0, 7) === month)
        .reduce((sum, log) => sum + log.hours, 0);
}

function placeWork(work: PhaseWork, anchor: string | null, today: string): Placed | null {
    if (work.ignored) return null;
    if (work.task) {
        const placement = displayPhase({
            anchor, today, dueDate: work.task.dueDate, status: work.task.status,
            planPhase: work.task.planPhase, locked: work.task.planPhaseLocked,
        });
        const month = placement.column.startsWith('month_') && anchor ? phaseCalendarMonth(anchor, placement.column as StoredPhase) : /^\d{4}-\d{2}$/.test(placement.column) ? placement.column : null;
        return {
            column: placement.column, task: work.task, month,
            card: {
                id: work.task.id, title: work.task.title, owner: work.owner || 'Unassigned',
                dueLabel: shortDueLabel(placement.dueDate), dueDate: placement.dueDate,
                slipped: placement.slipped, slipLabel: placement.slipLabel, done: COMPLETE.has(work.task.status),
            },
        };
    }
    if (work.onboardingChecklist) {
        const due = work.dueDate?.slice(0, 10) || null;
        return {
            column: 'onboarding', task: null, month: null,
            card: {
                id: work.id, title: work.title, owner: work.owner || 'Unassigned', dueLabel: shortDueLabel(due), dueDate: due,
                slipped: false, slipLabel: null, done: !!work.done,
            },
        };
    }
    const placement = displayPhase({ anchor, today, dueDate: work.dueDate, status: work.done ? 'done' : 'todo' });
    const month = placement.column.startsWith('month_') && anchor ? phaseCalendarMonth(anchor, placement.column as StoredPhase) : /^\d{4}-\d{2}$/.test(placement.column) ? placement.column : null;
    return {
        column: placement.column, task: null, month,
        card: {
            id: work.id, title: work.title, owner: work.owner || 'Unassigned',
            dueLabel: shortDueLabel(placement.dueDate), dueDate: placement.dueDate,
            slipped: placement.slipped, slipLabel: placement.slipLabel, done: !!work.done,
        },
    };
}

function columnKeys(anchor: string | null, today: string, placed: Placed[]): string[] {
    if (!anchor) {
        const current = today.slice(0, 7);
        const months = placed.flatMap(item => item.month ? [item.month] : []);
        let start = months.reduce((earliest, month) => month < earliest ? month : earliest, current);
        if (start > current) start = current;
        let end = shiftMonth(current, 2);
        for (const month of months) if (month > end) end = month;
        const keys = ['needs_date', 'onboarding'];
        for (let month = start, guard = 0; month <= end && guard < 60; month = shiftMonth(month, 1), guard += 1) keys.push(month);
        return keys;
    }
    const todayPhase = phaseAt(anchor, today) ?? 'onboarding';
    let furthest = (todayPhase === 'onboarding' ? 0 : phaseRank(todayPhase)) + 2;
    for (const item of placed) if (item.column.startsWith('month_')) furthest = Math.max(furthest, phaseRank(item.column as StoredPhase));
    const keys = ['needs_date', 'onboarding'];
    for (let index = 1; index <= Math.max(furthest, 1); index += 1) keys.push(`month_${index}`);
    return keys;
}

function coverageFor(agreements: ClientAgreement[] | null, failed: boolean, month: string): 'failed' | 'missing' | 'gap' | 'ok' {
    if (failed || !agreements) return 'failed';
    if (!agreements.length) return 'missing';
    const period = agreementPeriod(agreements, month);
    if (!period.segments.length || period.uncoveredDays >= daysInMonth(month)) return 'gap';
    return 'ok';
}

function commitmentRows(agreements: ClientAgreement[], month: string, placed: Placed[], logs: PhaseLog[] | null, logsFailed: boolean): TimelineCommitment[] {
    const period = agreementPeriod(agreements, month);
    const rows = new Map<string, TimelineCommitment & { agreementId: string; estimates: Array<number | null | undefined>; taskIds: string[] }>();
    for (const segment of period.segments) {
        for (const service of segment.agreement.services) {
            if (!service.sourceId || rows.has(service.sourceId)) continue;
            rows.set(service.sourceId, {
                id: service.sourceId, title: service.title, agreementId: segment.agreement.id,
                plannedLabel: '—', deliveredLabel: '—', mismatch: false, estimates: [], taskIds: [],
            });
        }
    }
    for (const item of placed) {
        const commitmentId = item.task?.commitmentId;
        if (!commitmentId || !rows.has(commitmentId)) continue;
        const row = rows.get(commitmentId)!;
        row.estimates.push(item.task?.estimatedHours);
        row.taskIds.push(item.task!.id);
        if (item.task?.agreementId && item.task.agreementId !== row.agreementId) row.mismatch = true;
    }
    return [...rows.values()].map(row => {
        const linked = row.taskIds.length > 0;
        return {
            id: row.id, title: row.title, mismatch: row.mismatch,
            plannedLabel: linked ? plannedLabel(row.estimates, false) : '—',
            deliveredLabel: linked ? deliveredLabel(deliveredHours(logs, logsFailed, new Set(row.taskIds), month), false) : '—',
        };
    });
}

export function buildTimeline(input: {
    work: PhaseWork[];
    agreements: ClientAgreement[] | null;
    agreementsFailed: boolean;
    today: string;
    logs: PhaseLog[] | null;
    logsFailed: boolean;
}): TimelineModel {
    if (input.agreements == null && !input.agreementsFailed) return { pending: true, notice: null, columns: [] };
    const agreements = input.agreementsFailed ? null : input.agreements ?? [];
    const anchor = agreements?.length ? phaseAnchor(agreements) : null;
    const seen = new Set<string>();
    const placed = input.work.flatMap(work => {
        const item = placeWork(work, anchor, input.today);
        if (!item || seen.has(item.card.id)) return [];
        seen.add(item.card.id);
        return [item];
    });
    const notice = input.agreementsFailed ? AGREEMENT_HISTORY_UNAVAILABLE : anchor ? null : AGREEMENT_NOT_RECORDED;
    const columns = columnKeys(anchor, input.today, placed).map(key => {
        const cards = placed.filter(item => item.column === key).map(item => item.card)
            .sort((a, b) => Number(a.slipped) - Number(b.slipped) || (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.title.localeCompare(b.title));
        if (key === 'needs_date') {
            const count = cards.length;
            return { key, title: 'Needs a date', meta: count ? `${count} ${count === 1 ? 'task' : 'tasks'}` : '—', agreementLabel: null, cards, commitments: [] };
        }
        if (key === 'onboarding') {
            const done = cards.filter(card => card.done).length;
            return { key, title: 'Onboarding', meta: cards.length ? `${done} of ${cards.length}` : '—', agreementLabel: null, cards, commitments: [] };
        }
        const month = key.startsWith('month_') && anchor ? phaseCalendarMonth(anchor, key as StoredPhase) : key;
        const title = key.startsWith('month_') && month ? `Month ${phaseRank(key as StoredPhase)} · ${calendarMonthLabel(month)}` : month ? calendarMonthLabel(month) : key;
        const coverage = month ? coverageFor(agreements, input.agreementsFailed, month) : 'failed';
        const hide = coverage !== 'ok';
        const outside = coverage === 'gap';
        const tasks = placed.filter(item => item.column === key && item.task);
        const planned = plannedLabel(tasks.map(item => item.task?.estimatedHours), hide);
        const delivered = outside ? deliveredLabel(null, true) : deliveredLabel(deliveredHours(input.logs, input.logsFailed || hide, new Set(tasks.flatMap(item => item.task ? [item.task.id] : [])), month ?? ''), false);
        const budget = coverage === 'ok' && agreements && month ? agreementPeriod(agreements, month).monthlyBudget : null;
        return {
            key, title, cards, agreementLabel: `In the agreement ${formatHourQuota(budget)}`,
            meta: outside ? 'Planned — · Delivered — · outside an agreement' : `Planned ${planned} · Delivered ${delivered}`,
            commitments: coverage === 'ok' && agreements && month ? commitmentRows(agreements, month, tasks, input.logs, input.logsFailed) : [],
        };
    });
    return { pending: false, notice, columns };
}

/** This month keeps slipped work in today's phase and leaves every due date alone. */
export function thisMonthBoard(work: PhaseWork[], input: { anchor: string | null; today: string; month: string }): MonthBoard {
    const current = input.anchor ? phaseAt(input.anchor, input.today) : null;
    const currentMonth = input.anchor && current ? phaseCalendarMonth(input.anchor, current) : null;
    const needsDate: string[] = [];
    const due: string[] = [];
    const slipped: MonthBoard['slipped'] = [];
    const seen = new Set<string>();
    for (const item of work) {
        const task = item.task;
        if (!task || item.ignored || seen.has(task.id)) continue;
        seen.add(task.id);
        const placement = displayPhase({
            anchor: input.anchor, today: input.today, dueDate: task.dueDate, status: task.status,
            planPhase: task.planPhase, locked: task.planPhaseLocked,
        });
        if (!task.dueDate && !COMPLETE.has(task.status)) needsDate.push(task.id);
        if (placement.slipped && placement.slipLabel && currentMonth === input.month) slipped.push({ id: task.id, slipLabel: placement.slipLabel });
        else if (task.dueDate?.slice(0, 7) === input.month && !placement.slipped) due.push(task.id);
    }
    return { needsDate, due, slipped };
}

export function phaseWorkFromItems(items: Array<{
    id: string;
    title: string;
    status: string;
    roadmapIncluded?: boolean;
    roadmapPhase?: string | null;
    source?: string | null;
    dueDate?: string | null;
    assigneeId?: string | null;
    linkedTask?: PhaseTask | null;
}>, ownerName: (ids: string[]) => string): PhaseWork[] {
    return items.map(item => ({
        id: item.id,
        title: item.linkedTask?.title ?? item.title,
        ignored: !(item.roadmapIncluded ?? item.status !== 'ignored'),
        done: item.status === 'done',
        onboardingChecklist: !item.linkedTask && (item.source === 'onboarding' || item.roadmapPhase === 'onboarding'),
        dueDate: item.linkedTask?.dueDate ?? item.dueDate ?? null,
        owner: ownerName(item.linkedTask?.assigneeIds ?? (item.assigneeId ? [item.assigneeId] : [])),
        task: item.linkedTask ?? null,
    }));
}

export function commitmentChoices(agreements: ClientAgreement[]): Array<{ id: string; title: string; agreementId: string }> {
    const choices = new Map<string, { id: string; title: string; agreementId: string }>();
    for (const agreement of agreements.filter(item => !item.cancelledAt).sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.id.localeCompare(b.id))) {
        for (const service of agreement.services) {
            if (!service.sourceId) continue;
            choices.set(service.sourceId, { id: service.sourceId, title: service.title, agreementId: agreement.id });
        }
    }
    return [...choices.values()];
}

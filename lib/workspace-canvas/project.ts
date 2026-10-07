/**
 * Pure projection for the opt-in client Overview canvas.
 *
 * Work lanes follow marketing-plan execution: linked tasks own status, done
 * and approved are complete, and ignored plan items stay out of the board.
 * Search figures are Google Search Console property totals only. Missing
 * days stay null. Hours never fall back to stored `hoursUsed`.
 */

import { Parser } from 'htmlparser2';

import { setupHoursStatus, type ClientSetupScope } from '../client-setup';
import { dateOffset, historyDates, historyWindow } from '../gsc/history';
import { taskIsComplete } from '../marketing-plan-execution';
import { ROADMAP_PHASES, isInRoadmap, type RoadmapPhase } from '../marketing-plan-roadmap';
import type { Task } from '../types';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DELIVERED_DELIVERABLE = new Set(['Approved', 'Published']);

export const LANE_PREVIEW_LIMIT = 4;

export function isMonthKey(value: string | null | undefined): value is string {
    return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function monthBounds(month: string): { start: string; end: string; days: string[] } {
    const [year, monthIndex] = month.split('-').map(Number);
    const last = new Date(year, monthIndex, 0).getDate();
    const days = Array.from({ length: last }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
    return { start: days[0], end: days[last - 1], days };
}

export function shiftMonth(month: string, delta: number): string {
    const [year, monthIndex] = month.split('-').map(Number);
    const date = new Date(year, monthIndex - 1 + delta, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function formatMonthLabel(month: string): string {
    const [year, monthIndex] = month.split('-').map(Number);
    return `${MONTH_NAMES[monthIndex - 1]} ${year}`;
}

export function formatDayLabel(iso: string): string {
    const [year, monthIndex, day] = iso.slice(0, 10).split('-').map(Number);
    return `${SHORT_MONTHS[monthIndex - 1]} ${day}, ${year}`;
}

export function assigneeLabel(names: string[]): string {
    const clean = names.map(name => name.trim()).filter(Boolean);
    if (clean.length === 0) return 'No assignee';
    if (clean.length <= 2) return clean.join(', ');
    return `${clean.slice(0, 2).join(', ')} +${clean.length - 2}`;
}

export function resolveAssigneeNames(ids: string[], members: { id: string; name: string }[]): string[] {
    const names = new Map(members.map(member => [member.id, member.name]));
    return [...new Set(ids)].map(id => names.get(id)?.trim() || 'Unknown assignee');
}

/** Ignore a finished request after the client, organization, or month changed. */
export function settleLatest<T>(requestId: number, latestId: number, value: T): T | null {
    return requestId === latestId ? value : null;
}

export function performanceWindow(month: string, availableThrough: string): { start: string; end: string } | null {
    const { start, end } = monthBounds(month);
    if (start > availableThrough) return null;
    return { start, end: end < availableThrough ? end : availableThrough };
}

export function previousEqualWindow(start: string, end: string): { start: string; end: string } {
    const count = historyDates(start, end).length;
    const endDate = dateOffset(start, -1);
    return { start: dateOffset(endDate, 1 - count), end: endDate };
}

export function availableThrough(now = new Date()): string {
    return historyWindow(now).end;
}

export interface DailyPoint {
    date: string;
    clicks: number | null;
    impressions: number | null;
    isIncomplete?: boolean;
}

export function buildDailySeries(
    start: string,
    end: string,
    days: { id: string; date: string; isIncomplete?: boolean }[],
    rows: { dayId: string; clicks: number; impressions: number }[],
): DailyPoint[] {
    return historyDates(start, end).map(date => {
        const day = days.find(item => item.date === date);
        if (!day) return { date, clicks: null, impressions: null };
        const matched = rows.filter(row => row.dayId === day.id);
        if (day.isIncomplete && !matched.length) return {date, clicks:null, impressions:null, isIncomplete:true};
        return {
            date,
            isIncomplete: day.isIncomplete ?? false,
            clicks: matched.reduce((sum, row) => sum + row.clicks, 0),
            impressions: matched.reduce((sum, row) => sum + row.impressions, 0),
        };
    });
}

export interface CanvasTask {
    id: string;
    title: string;
    description?: string;
    status: Task['status'];
    dueDate?: string | null;
    startDate?: string | null;
    completedAt?: string | null;
    estimatedHours?: number | null;
    assignees: string[];
    subtasks: { id: string; title: string; completed: boolean }[];
}

export interface CanvasPlanItem {
    id: string;
    title: string;
    description?: string;
    status: 'todo' | 'done' | 'ignored';
    dueDate?: string | null;
    roadmapIncluded?: boolean;
    roadmapPhase?: RoadmapPhase;
    taskId?: string;
    linkedTask?: CanvasTask;
    assignees?: string[];
}

export interface CanvasDeliverable {
    id: string;
    title: string;
    status: string;
    dueDate?: string | null;
}

export interface CanvasApprovalDoc {
    id: string;
    batchId: string;
    batchName: string;
    batchStatus: 'draft' | 'in_review' | 'completed' | 'archived';
    sentAt?: string | null;
    title: string;
    status: 'pending' | 'approved' | 'approved_with_edits' | 'changes_requested';
    archivedAt?: string | null;
    deliverableId?: string | null;
}

export interface CanvasClient {
    engagementModel: 'Campaign' | 'Retainer';
    status: string;
    launchDate?: string;
    seoHours: number;
    retainerMonthlyHours?: number | null;
    setupScope?: ClientSetupScope | null;
    campaignConfig?: { startDate?: string; endDate?: string; totalHours?: number } | null;
}

export type SourceResult<T> = { ok: true; value: T } | { ok: false };

export interface WorkspaceCanvasInput {
    agreementHours?: SourceResult<import('../agreements/types').AgreementHoursSummary>;
    month: string;
    today: string;
    availableThrough: string;
    client: CanvasClient;
    tasks: SourceResult<CanvasTask[]>;
    plan: SourceResult<{ goal?: string; items: CanvasPlanItem[] } | null>;
    monthHours: SourceResult<number>;
    campaignHours: SourceResult<number> | { skipped: true };
    deliverables: SourceResult<CanvasDeliverable[]>;
    approvals: SourceResult<CanvasApprovalDoc[]>;
    search: SearchInput;
}

export type SearchInput =
    | { ok: false; message: string }
    | { ok: true; coverage: 'none' }
    | {
        ok: true;
        coverage: 'ready';
        refreshPending?: boolean;
        connectionHealth?: 'connected' | 'reconnect' | 'interrupted';
        property: string;
        lastSync: string | null;
        window: { start: string; end: string };
        current: DailyPoint[];
        previous: DailyPoint[] | null;
    };

export interface ChartPoint {
    isIncomplete?: boolean;
    date: string;
    clicks: number | null;
    previousDate: string | null;
    previousClicks: number | null;
}

export type Delta =
    | { kind: 'percent'; percent: number }
    | { kind: 'no_baseline' }
    | { kind: 'insufficient' }
    | { kind: 'unavailable' }
    | { kind: 'preliminary' };

export interface MetricFigure {
    label: string;
    total: number | null;
    delta: Delta;
}

export interface PerformanceModel {
    state: 'error' | 'no_coverage' | 'ready';
    connectionHealth?: 'connected' | 'reconnect' | 'interrupted';
    message: string;
    property?: string;
    lastSync: string | null;
    availableThrough: string;
    rangeLabel?: string;
    previousRangeLabel?: string;
    clicks?: MetricFigure;
    impressions?: MetricFigure;
    points: ChartPoint[];
    showPrevious: boolean;
    observedDays: number;
    expectedDays: number;
    missingDays: number;
    hasPreliminaryData?: boolean;
}

export interface HoursGauge {
    mode: 'arc' | 'none' | 'unavailable';
    logged: number | null;
    budget: number | null;
    /** Actual logged / budget. May exceed 1. Null when there is no positive budget. */
    ratio: number | null;
    /** Visual arc, clamped to 1. */
    arc: number | null;
    over: boolean;
}

export interface HoursModel {
    agreementRows?: Array<{id:string;title:string;label:string;logged:number;budget:number|null;unit:string}>;
    unassignedHours?: number;
    kind: 'monthly' | 'campaign_total' | 'custom';
    label: string;
    detail: string;
    status: string;
    monthLogged: number | null;
    monthUnavailable: boolean;
    gauge: HoursGauge;
}

export interface AttentionItem {
    id: string;
    kind: 'approval' | 'deliverable' | 'blocked';
    older?: boolean;
    date?: string;
    deliverableId?: string;
    title: string;
    detail: string;
    action: 'review' | 'deliverables' | 'task';
    batchId?: string;
    taskId?: string;
}

export interface AttentionModel {
    items: AttentionItem[];
    approvalsUnavailable: boolean;
    deliverablesUnavailable: boolean;
    tasksUnavailable: boolean;
    /** Document count only. Batches are not added on top. */
    approvalDocuments: number | null;
}

export interface PhaseSummary {
    key: RoadmapPhase;
    label: string;
    total: number;
    done: number;
}

export interface PhasesModel {
    state: 'error' | 'empty' | 'ready';
    phases: PhaseSummary[];
}

export interface WorkCard {
    id: string;
    source: 'task' | 'plan';
    taskId?: string;
    planItemId?: string;
    title: string;
    description?: string;
    statusLabel: string;
    badges: string[];
    dueDate?: string;
    startDate?: string;
    assignees: string[];
    assigneeLabel: string;
    estimateLabel: string;
    subtasks: { id: string; title: string; completed: boolean }[];
    subtaskProgress: string;
}

export interface ImpactEntry {
    id: string;
    title: string;
    detail: string;
}

export interface BoardModel {
    state: 'error' | 'ready';
    /** Set when tasks failed. Lanes are not an empty-work claim in that case. */
    tasksUnavailable: boolean;
    now: WorkCard[];
    next: WorkCard[];
    unscheduled: WorkCard[];
    impact: ImpactEntry[];
}

export interface TimelineBar {
    id: string;
    cardId: string;
    title: string;
    /** Inclusive column indexes within the month, 0-based. */
    startIndex: number;
    endIndex: number;
    point: boolean;
    label: string;
}

export interface DeadlineItem {
    id: string;
    title: string;
    dueDate: string;
    kind: 'task' | 'deliverable';
    cardId?: string;
}

export interface TimelineModel {
    days: string[];
    bars: TimelineBar[];
    deadlinesTitle: string;
    deadlines: DeadlineItem[];
}

export interface WorkspaceCanvasModel {
    month: string;
    monthLabel: string;
    performance: PerformanceModel;
    hours: HoursModel;
    attention: AttentionModel;
    phases: PhasesModel;
    board: BoardModel;
    timeline: TimelineModel;
    cards: WorkCard[];
}

function taskComplete(task: CanvasTask): boolean {
    return taskIsComplete({ status: task.status } as Task);
}

function day(value?: string | null): string | undefined {
    if (!value) return undefined;
    const iso = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : undefined;
}

function coverageOf(points: DailyPoint[], metric: 'clicks' | 'impressions') {
    const observed = points.filter(point => point[metric] != null);
    const sum = observed.reduce((total, point) => total + (point[metric] ?? 0), 0);
    return {
        expected: points.length,
        observed: observed.length,
        missing: points.length - observed.length,
        sum: observed.length ? sum : null,
        // A partial import total is not comparable to a complete period total.
        sufficient: points.length > 0 && observed.length === points.length,
    };
}

function deltaFor(current: ReturnType<typeof coverageOf>, previous: ReturnType<typeof coverageOf> | null, previousLoaded: boolean): Delta {
    if (!previousLoaded || !previous) return { kind: 'unavailable' };
    if (!current.sufficient || !previous.sufficient || current.sum == null || previous.sum == null) return { kind: 'insufficient' };
    if (previous.sum === 0) return { kind: 'no_baseline' };
    return { kind: 'percent', percent: (current.sum - previous.sum) / previous.sum };
}

function projectPerformance(input: WorkspaceCanvasInput): PerformanceModel {
    const base = {
        availableThrough: input.availableThrough,
        lastSync: null as string | null,
        points: [] as ChartPoint[],
        showPrevious: false,
        observedDays: 0,
        expectedDays: 0,
        missingDays: 0,
    };
    if (!input.search.ok) {
        return { ...base, state: 'error', message: input.search.message || 'Search Console data could not be loaded.' };
    }
    if (input.search.coverage === 'none') {
        return {
            ...base,
            state: 'no_coverage',
            message: `Search data is requested through ${formatDayLabel(input.availableThrough)}. ${formatMonthLabel(input.month)} has no available search data yet. Hours and work below still use ${formatMonthLabel(input.month)}.`,
        };
    }
    const current = input.search.current;
    const previous = input.search.previous;
    const lengthsMatch = !!previous && previous.length === current.length;
    const clickCoverage = coverageOf(current, 'clicks');
    const previousClicks = lengthsMatch && previous ? coverageOf(previous, 'clicks') : null;
    const impressionCoverage = coverageOf(current, 'impressions');
    const previousImpressions = lengthsMatch && previous ? coverageOf(previous, 'impressions') : null;
    const partialToday = current.some(point => point.date === input.today && point.isIncomplete);
    const showPrevious = !partialToday && !!previousClicks?.sufficient && clickCoverage.sufficient;
    const rangeLabel = `${formatDayLabel(input.search.window.start)} – ${formatDayLabel(input.search.window.end)}`;
    const previousRangeLabel = previous && previous.length
        ? `${formatDayLabel(previous[0].date)} – ${formatDayLabel(previous[previous.length - 1].date)}`
        : undefined;
    const points = current.map((point, index) => ({
        date: point.date,
        clicks: point.clicks,
        isIncomplete: point.isIncomplete,
        previousDate: showPrevious && previous ? previous[index].date : null,
        previousClicks: showPrevious && previous ? previous[index].clicks : null,
    }));
    const missingNote = clickCoverage.missing > 0
        ? 'This period is still updating. Gaps represent unavailable data, not zero clicks.'
        : '';
    const comparisonNote = partialToday
        ? "Today's search data is preliminary; the comparison is paused until this day is complete."
        : !previous
        ? 'The previous period could not be loaded, so no comparison is shown.'
        : !lengthsMatch
            ? 'The previous period did not line up with this window, so no comparison is shown.'
            : showPrevious
                ? `Dashed series is ${previousRangeLabel}.`
                : 'The dashed comparison is hidden because coverage is too thin to compare.';
    return {
        ...base,
        state: 'ready',
        property: input.search.property,
        connectionHealth: input.search.connectionHealth,
        lastSync: input.search.lastSync,
        message: `Organic search clicks from ${input.search.property}. ${rangeLabel}. ${missingNote} ${comparisonNote}`,
        rangeLabel,
        previousRangeLabel,
        clicks: {
            label: 'Organic search clicks',
            total: clickCoverage.sum,
            delta: partialToday ? {kind:'preliminary'} : deltaFor(clickCoverage, previousClicks, lengthsMatch),
        },
        impressions: {
            label: 'Search impressions',
            total: impressionCoverage.sum,
            delta: partialToday ? {kind:'preliminary'} : deltaFor(impressionCoverage, previousImpressions, lengthsMatch),
        },
        points,
        showPrevious,
        hasPreliminaryData: current.some(point => point.isIncomplete && point.clicks != null),
        observedDays: clickCoverage.observed,
        expectedDays: clickCoverage.expected,
        missingDays: clickCoverage.missing,
    };
}

function emptyGauge(mode: HoursGauge['mode']): HoursGauge {
    return { mode, logged: null, budget: null, ratio: null, arc: null, over: false };
}

function arcGauge(logged: number, budget: number): HoursGauge {
    const ratio = logged / budget;
    return { mode: 'arc', logged, budget, ratio, arc: Math.min(1, Math.max(0, ratio)), over: logged > budget };
}

function projectHours(input: WorkspaceCanvasInput): HoursModel {
    if(input.agreementHours) {
        if(!input.agreementHours.ok) return {kind:'custom',label:'Agreement hours',detail:'Agreement hours could not be loaded. Reload to see the correct historical allowance.',status:'Unavailable',monthLogged:null,monthUnavailable:true,gauge:emptyGauge('unavailable')};
        const summary=input.agreementHours.value;
        const rows=summary.rows.map(row=>({id:row.agreement.id,title:row.agreement.title,label:row.agreement.mode==='monthly' ? row.budget==null ? 'Prior monthly agreement' : 'Monthly' : 'Custom',logged:row.agreement.mode==='monthly' ? row.periodLogged : row.logged,budget:row.budget,unit:row.agreement.mode==='monthly' ? 'work logged this month' : 'agreement total'}));
        const total=summary.rows.reduce((n,row)=>n+row.periodLogged,summary.unassigned);
        const single=rows.length===1 && summary.unassigned===0 ? rows[0] : null;
        return {kind:single?.label==='Monthly' ? 'monthly' : 'custom',label:single?.label==='Monthly' ? 'Monthly hours' : 'Agreement hours',status:'Tracked',monthLogged:total,monthUnavailable:false,
            gauge:single && single.budget!=null && single.budget>0 ? arcGauge(single.logged,single.budget) : {...emptyGauge('none'),logged:total},
            agreementRows:rows,unassignedHours:summary.unassigned,
            detail:summary.period.mixed ? 'This month spans multiple scopes. Each allowance is shown against its own work.' : summary.period.uncoveredDays>0 ? `${summary.period.uncoveredDays} days have no agreement coverage. Prior owed work stays visible.` : 'Hours use the agreement effective for the selected period.'};
    }
    const custom = input.client.setupScope?.mode === 'custom';
    const campaign = !custom && input.client.engagementModel === 'Campaign';
    const monthLogged = input.monthHours.ok ? input.monthHours.value : null;
    const monthUnavailable = !input.monthHours.ok;

    if (custom) {
        return {
            kind: 'custom',
            label: 'Custom scope',
            status: monthUnavailable ? 'Unavailable' : 'Tracked',
            detail: monthUnavailable
                ? 'Hours could not be loaded. This is not zero. Custom work has no monthly retainer budget.'
                : 'Custom scope. The number is confirmed budget hours tracked this month, not a monthly cap.',
            monthLogged,
            monthUnavailable,
            gauge: { ...emptyGauge('none'), logged: monthLogged },
        };
    }

    if (campaign) {
        const config = input.client.campaignConfig;
        const budget = config?.totalHours ?? 0;
        const hasDates = !!config?.startDate && !!config?.endDate;
        if ('skipped' in input.campaignHours || !input.campaignHours.ok) {
            return {
                kind: 'campaign_total',
                label: 'Campaign total',
                status: 'Unavailable',
                detail: 'Campaign hours could not be loaded. A stored hours-used value is not shown in its place.',
                monthLogged,
                monthUnavailable,
                gauge: emptyGauge('unavailable'),
            };
        }
        if (budget <= 0 || !hasDates) {
            return {
                kind: 'campaign_total',
                label: 'Campaign total',
                status: budget <= 0 ? 'No budget' : 'No dates',
                detail: budget <= 0
                    ? 'No campaign hour budget is set. This is not shown as a monthly retainer.'
                    : 'Campaign dates are not set, so usage against the campaign total is unavailable.',
                monthLogged,
                monthUnavailable,
                gauge: { ...emptyGauge('none'), logged: monthLogged },
            };
        }
        const gauge = arcGauge(input.campaignHours.value, budget);
        const dateLabel = `${formatDayLabel(config!.startDate!)} – ${formatDayLabel(config!.endDate!)}`;
        return {
            kind: 'campaign_total',
            label: 'Campaign total',
            status: gauge.over ? 'Over' : 'Campaign total',
            detail: `${dateLabel}. This gauge is the full campaign, not ${formatMonthLabel(input.month)}.${monthLogged != null ? ` ${monthLogged} budget hours were logged in the selected month.` : ''}`,
            monthLogged,
            monthUnavailable,
            gauge,
        };
    }

    if (monthUnavailable || monthLogged == null) {
        return {
            kind: 'monthly',
            label: 'Monthly budget',
            status: 'Unavailable',
            detail: 'Hours could not be loaded. This is not zero, and stored hours are not used instead.',
            monthLogged: null,
            monthUnavailable: true,
            gauge: emptyGauge('unavailable'),
        };
    }
    const budget = input.client.seoHours || input.client.retainerMonthlyHours || 0;
    if (budget <= 0) {
        return {
            kind: 'monthly',
            label: 'Monthly budget',
            status: 'No budget',
            detail: monthLogged > 0
                ? `${monthLogged} confirmed budget hours are logged. No monthly budget is set, so there is no gauge.`
                : 'No monthly hour budget is set, and no budget hours are logged.',
            monthLogged,
            monthUnavailable: false,
            gauge: { ...emptyGauge('none'), logged: monthLogged, budget: 0 },
        };
    }
    const gauge = arcGauge(monthLogged, budget);
    const setup = input.client.setupScope
        ? setupHoursStatus(input.client.setupScope, input.client.status, input.client.launchDate, monthLogged, budget, input.month, input.today)
        : null;
    return {
        kind: 'monthly',
        label: 'Monthly budget',
        status: setup?.status ?? (gauge.over ? 'Over' : 'Logged'),
        detail: setup?.reason ?? (gauge.over
            ? `${(monthLogged - budget).toFixed(2)}h over the monthly budget. The arc stops at full; the number does not.`
            : 'Confirmed hours that count toward the monthly budget.'),
        monthLogged,
        monthUnavailable: false,
        gauge,
    };
}

const STATUS_LABELS: Record<Task['status'], string> = {
    todo: 'To do',
    in_progress: 'In progress',
    review: 'In review',
    approved: 'Approved',
    blocked: 'Blocked',
    done: 'Done',
};

function estimateLabel(hours?: number | null): string {
    if (hours == null || Number.isNaN(hours)) return 'No estimate';
    const rounded = Math.round(hours * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}h estimate` : `${rounded.toFixed(1)}h estimate`;
}

function subtaskProgress(subtasks: CanvasTask['subtasks']): string {
    if (subtasks.length === 0) return 'No subtasks';
    const done = subtasks.filter(item => item.completed).length;
    return `${done} / ${subtasks.length}`;
}

function cardFromTask(task: CanvasTask, month: string, today: string): WorkCard {
    const due = day(task.dueDate);
    const badges: string[] = [];
    if (task.status === 'blocked') badges.push('Blocked');
    if (task.status === 'review') badges.push('In review');
    if (due && due < `${month}-01`) badges.push('Carryover');
    if (due && due < today) badges.push('Overdue');
    return {
        id: `task:${task.id}`,
        source: 'task',
        taskId: task.id,
        title: task.title,
        description: workDescriptionPreview(task.description),
        statusLabel: STATUS_LABELS[task.status],
        badges,
        dueDate: due,
        startDate: day(task.startDate),
        assignees: task.assignees,
        assigneeLabel: assigneeLabel(task.assignees),
        estimateLabel: estimateLabel(task.estimatedHours),
        subtasks: task.subtasks,
        subtaskProgress: subtaskProgress(task.subtasks),
    };
}

function cardFromPlan(item: CanvasPlanItem, month: string, today: string): WorkCard {
    const due = day(item.dueDate);
    const badges: string[] = [];
    if (due && due < `${month}-01`) badges.push('Carryover');
    if (due && due < today) badges.push('Overdue');
    return {
        id: `plan:${item.id}`,
        source: 'plan',
        planItemId: item.id,
        title: item.title,
        description: workDescriptionPreview(item.description),
        statusLabel: item.status === 'done' ? 'Done' : 'To do',
        badges,
        dueDate: due,
        assignees: item.assignees ?? [],
        assigneeLabel: assigneeLabel(item.assignees ?? []),
        estimateLabel: 'No estimate',
        subtasks: [],
        subtaskProgress: 'No subtasks',
    };
}

function collectCards(tasks: CanvasTask[], items: CanvasPlanItem[], month: string, today: string): WorkCard[] {
    const cards = new Map<string, WorkCard>();
    for (const task of tasks) cards.set(task.id, cardFromTask(task, month, today));
    for (const item of items) {
        if (item.status === 'ignored') continue;
        const linkedId = item.linkedTask?.id ?? item.taskId;
        if (linkedId && cards.has(linkedId)) continue;
        if (item.linkedTask) {
            cards.set(item.linkedTask.id, cardFromTask(item.linkedTask, month, today));
            continue;
        }
        if (item.taskId) continue;
        cards.set(`plan:${item.id}`, cardFromPlan(item, month, today));
    }
    return [...cards.values()];
}

function planItemComplete(item: CanvasPlanItem, tasks: CanvasTask[]): boolean {
    const linked = item.linkedTask ?? tasks.find(task => task.id === item.taskId);
    if (linked) return taskComplete(linked);
    return item.status === 'done';
}

function projectPhases(input: WorkspaceCanvasInput): PhasesModel {
    if (!input.plan.ok) return { state: 'error', phases: [] };
    if (!input.plan.value) return { state: 'empty', phases: [] };
    const tasks = input.tasks.ok ? input.tasks.value : [];
    const items = input.plan.value.items.filter(item => isInRoadmap({
        roadmapIncluded: item.roadmapIncluded,
        status: item.status,
    } as Parameters<typeof isInRoadmap>[0]));
    return {
        state: 'ready',
        phases: ROADMAP_PHASES.map(([key, label]) => {
            const phaseItems = items.filter(item => (item.roadmapPhase ?? 'backlog') === key);
            return {
                key,
                label,
                total: phaseItems.length,
                done: phaseItems.filter(item => planItemComplete(item, tasks)).length,
            };
        }),
    };
}

/** Plain preview only: never render imported task HTML as markup. */
export function workDescriptionPreview(value?: string): string | undefined {
    if (!value) return undefined;
    const chunks: string[] = [];
    const blocks = new Set(['p', 'div', 'br', 'li', 'ul', 'ol', 'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr']);
    let excludedDepth = 0;
    const parser = new Parser({
        onopentag(name) {
            if (name === 'script' || name === 'style') excludedDepth += 1;
            if (!excludedDepth && blocks.has(name)) chunks.push(' ');
        },
        ontext(text) {
            if (!excludedDepth) chunks.push(text);
        },
        onclosetag(name) {
            if (name === 'script' || name === 'style') excludedDepth = Math.max(0, excludedDepth - 1);
            if (!excludedDepth && blocks.has(name)) chunks.push(' ');
        },
    }, { decodeEntities: true });
    parser.end(value);
    return chunks.join('').replace(/\s+/g, ' ').trim() || undefined;
}

function byDueThenTitle(a: WorkCard, b: WorkCard): number {
    return (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99') || a.title.localeCompare(b.title);
}

function nowRank(card: WorkCard): number {
    if (card.badges.includes('Blocked')) return 0;
    if (card.badges.includes('Overdue')) return 1;
    if (card.badges.includes('Carryover')) return 2;
    if (card.badges.includes('In review')) return 3;
    return 4;
}

function incomplete(card: WorkCard): boolean {
    return card.statusLabel !== 'Done' && card.statusLabel !== 'Approved';
}

function projectImpact(input: WorkspaceCanvasInput, performance: PerformanceModel): ImpactEntry[] {
    const entries: ImpactEntry[] = [];
    if (performance.state === 'error') {
        entries.push({ id: 'search-unavailable', title: 'Search outcomes unavailable', detail: 'Clicks could not be loaded. No change is assumed.' });
    } else if (performance.clicks && performance.clicks.total != null && performance.rangeLabel) {
        const delta = performance.clicks.delta.kind === 'percent'
            ? ` ${performance.clicks.delta.percent >= 0 ? 'Up' : 'Down'} ${Math.abs(Math.round(performance.clicks.delta.percent * 100))}% versus ${performance.previousRangeLabel}.`
            : performance.clicks.delta.kind === 'no_baseline'
                ? ' No comparable baseline for the previous period.'
                : '';
        entries.push({
            id: 'search-clicks',
            title: `${performance.clicks.total.toLocaleString('en-US')} organic search clicks`,
            detail: `${performance.rangeLabel}.${delta} This is observed Search Console performance. It is not attributed to the work listed here.`,
        });
    } else if (performance.state === 'no_coverage') {
        entries.push({ id: 'search-none', title: 'No finalized search days', detail: performance.message });
    }

    if (!input.tasks.ok) {
        entries.push({ id: 'work-unavailable', title: 'Completed work unavailable', detail: 'Tasks could not be loaded, so completed work is not shown as zero.' });
    } else {
        const recorded = input.tasks.value.filter(task => taskComplete(task) && day(task.completedAt)?.slice(0, 7) === input.month);
        const dueComplete = input.tasks.value.filter(task => {
            if (!taskComplete(task) || day(task.dueDate)?.slice(0, 7) !== input.month) return false;
            return day(task.completedAt)?.slice(0, 7) !== input.month;
        });
        if (recorded.length === 0 && dueComplete.length === 0) {
            entries.push({ id: 'work-none', title: 'No completed work for this month', detail: 'Nothing is marked complete with a recorded date or due date in this month.' });
        } else {
            const parts = [
                recorded.length ? `${recorded.length} recorded complete this month` : '',
                dueComplete.length ? `${dueComplete.length} marked complete and due this month` : '',
            ].filter(Boolean);
            entries.push({
                id: 'work-complete',
                title: 'Completed work',
                detail: `${parts.join(' · ')}. Completion is not treated as the cause of a search change.`,
            });
        }
    }

    const goal = input.plan.ok ? input.plan.value?.goal?.trim() : '';
    if (goal) entries.push({ id: 'plan-goal', title: 'Plan goal', detail: goal });
    return entries;
}

function projectBoard(input: WorkspaceCanvasInput, performance: PerformanceModel): { board: BoardModel; cards: WorkCard[] } {
    if (!input.tasks.ok && !input.plan.ok) {
        return { cards: [], board: { state: 'error', tasksUnavailable: true, now: [], next: [], unscheduled: [], impact: projectImpact(input, performance) } };
    }
    const tasks = input.tasks.ok ? input.tasks.value : [];
    const items = input.plan.ok ? input.plan.value?.items ?? [] : [];
    const cards = collectCards(tasks, items, input.month, input.today);
    const open = cards.filter(incomplete);
    const { end } = monthBounds(input.month);
    const now = open.filter(card => card.dueDate && card.dueDate <= end).sort((a, b) => nowRank(a) - nowRank(b) || byDueThenTitle(a, b));
    const next = open.filter(card => card.dueDate && card.dueDate > end).sort(byDueThenTitle);
    const unscheduled = open.filter(card => !card.dueDate).sort((a, b) => a.title.localeCompare(b.title));
    return {
        cards,
        board: { state: 'ready', tasksUnavailable: !input.tasks.ok, now, next, unscheduled, impact: projectImpact(input, performance) },
    };
}

function projectTimeline(input: WorkspaceCanvasInput, cards: WorkCard[]): TimelineModel {
    const { days, end } = monthBounds(input.month);
    const index = new Map(days.map((date, position) => [date, position]));
    const bars: TimelineBar[] = [];
    for (const card of cards) {
        const due = card.dueDate;
        const start = card.startDate;
        if (due && due >= days[0] && due <= end && (!start || start >= due)) {
            bars.push({ id: `${card.id}:due`, cardId: card.id, title: card.title, startIndex: index.get(due) ?? 0, endIndex: index.get(due) ?? 0, point: true, label: `Due ${formatDayLabel(due)}` });
            continue;
        }
        if (start && due && start < due) {
            const visibleStart = start < days[0] ? days[0] : start;
            const visibleEnd = due > end ? end : due;
            if (visibleStart > end || visibleEnd < days[0]) continue;
            const startIndex = index.get(visibleStart);
            const endIndex = index.get(visibleEnd);
            if (startIndex == null || endIndex == null) continue;
            bars.push({
                id: `${card.id}:span`,
                cardId: card.id,
                title: card.title,
                startIndex,
                endIndex,
                point: startIndex === endIndex,
                label: `${formatDayLabel(start)} – ${formatDayLabel(due)}`,
            });
            continue;
        }
        if (start && !due && index.has(start)) {
            bars.push({ id: `${card.id}:start`, cardId: card.id, title: card.title, startIndex: index.get(start) ?? 0, endIndex: index.get(start) ?? 0, point: true, label: `Starts ${formatDayLabel(start)}` });
        }
    }
    const past = end < input.today;
    const deadlines: DeadlineItem[] = [];
    if (input.tasks.ok) {
        for (const task of input.tasks.value) {
            const due = day(task.dueDate);
            if (!due || due.slice(0, 7) !== input.month || taskComplete(task)) continue;
            if (!past && due < input.today) continue;
            deadlines.push({ id: `deadline:${task.id}`, title: task.title, dueDate: due, kind: 'task', cardId: `task:${task.id}` });
        }
    }
    if (input.deliverables.ok) {
        for (const item of input.deliverables.value) {
            const due = day(item.dueDate);
            if (!due || due.slice(0, 7) !== input.month || DELIVERED_DELIVERABLE.has(item.status)) continue;
            if (!past && due < input.today) continue;
            deadlines.push({ id: `deadline-deliverable:${item.id}`, title: item.title, dueDate: due, kind: 'deliverable' });
        }
    }
    deadlines.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
    return {
        days,
        bars,
        deadlinesTitle: past ? `Deadlines in ${formatMonthLabel(input.month)}` : 'Upcoming deadlines',
        deadlines,
    };
}

function projectAttention(input: WorkspaceCanvasInput): AttentionModel {
    const items: AttentionItem[] = [];
    let approvalDocuments: number | null = null;
    const claimedDeliverables = new Set<string>();
    if (input.approvals.ok) {
        const docs = input.approvals.value.filter(doc => {
            if (doc.archivedAt || doc.batchStatus !== 'in_review') return false;
            if (!doc.sentAt) return false;
            return doc.status === 'pending' || doc.status === 'changes_requested';
        });
        approvalDocuments = docs.length;
        for (const doc of docs) {
            if (doc.deliverableId) claimedDeliverables.add(doc.deliverableId);
            items.push({
                id: `approval:${doc.id}`,
                kind: 'approval',
                date: day(doc.sentAt),
                title: doc.title,
                detail: doc.status === 'changes_requested'
                    ? `${doc.batchName} · Changes requested`
                    : `${doc.batchName} · Awaiting decision`,
                action: 'review',
                batchId: doc.batchId,
            });
        }
    }
    if (input.deliverables.ok) {
        for (const item of input.deliverables.value) {
            const due = day(item.dueDate);
            if (!due || due >= input.today || DELIVERED_DELIVERABLE.has(item.status) || claimedDeliverables.has(item.id)) continue;
            items.push({
                id: `deliverable:${item.id}`,
                kind: 'deliverable',
                older: due < dateOffset(input.today, -30),
                date: due,
                deliverableId: item.id,
                title: item.title,
                detail: `Overdue deliverable · due ${formatDayLabel(due)}`,
                action: 'deliverables',
            });
        }
    }
    if (input.tasks.ok) {
        for (const task of input.tasks.value) {
            if (task.status !== 'blocked') continue;
            items.push({
                id: `blocked:${task.id}`,
                kind: 'blocked',
                date: day(task.dueDate),
                title: task.title,
                detail: 'Blocked task',
                action: 'task',
                taskId: task.id,
            });
        }
    }
    return {
        items: items.sort((a, b) => {
            const rank = { approval: 0, blocked: 1, deliverable: 2 };
            return Number(!!a.older) - Number(!!b.older) || rank[a.kind] - rank[b.kind]
                || (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
        }),
        approvalsUnavailable: !input.approvals.ok,
        deliverablesUnavailable: !input.deliverables.ok,
        tasksUnavailable: !input.tasks.ok,
        approvalDocuments,
    };
}

export function projectWorkspaceCanvas(input: WorkspaceCanvasInput): WorkspaceCanvasModel {
    const performance = projectPerformance(input);
    const { board, cards } = projectBoard(input, performance);
    return {
        month: input.month,
        monthLabel: formatMonthLabel(input.month),
        performance,
        hours: projectHours(input),
        attention: projectAttention(input),
        phases: projectPhases(input),
        board,
        timeline: projectTimeline(input, cards),
        cards,
    };
}

export { historyWindow };

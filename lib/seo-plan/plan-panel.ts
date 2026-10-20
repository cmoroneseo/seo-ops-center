import { applyStageReorder, type StageReorderMove } from './stage-reorder';
import { groupTasksByStage, type StageListTask } from './stage-list';
import { isPendingStageTaskId } from './stage-add';
import { formatPlanDue, formatPlanHours, isPlanDone, planMonthTitle } from './plan-sections';
import { dueDay, formatDueDay } from './this-month';
import { isTaskStage } from '../tasks/stage';
import { parseLiveUrlInput } from '../tasks/live-url';
import type { Task, TaskStage } from '../types';

/**
 * Side panel for one SEO Plan task.
 *
 * Status on screen is To do, In progress, or Done. #187 (open, not merged)
 * rewrites review → in_progress, approved → done, and blocked → the previous
 * status plus tasks.blocked_reason. Until that lands, this panel only offers
 * the three statuses and shows a legacy value as the closest of those three.
 * Opening a task does not rewrite it.
 *
 * FOLLOW-UP: the Blocked label (reason required, chip on the row, cleared on
 * Done) waits on tasks.blocked_reason from #187. This panel does not store it.
 */
export const PLAN_BLOCKED_LABEL_FOLLOW_UP = 'tasks.blocked_reason' as const;

export const PLAN_PANEL_STATUSES = ['todo', 'in_progress', 'done'] as const;
export type PlanPanelStatus = (typeof PLAN_PANEL_STATUSES)[number];

export const PLAN_PANEL_STATUS_LABEL: Record<PlanPanelStatus, string> = {
    todo: 'To do',
    in_progress: 'In progress',
    done: 'Done',
};

export const PLAN_LABELS = [
    { id: 'content', label: 'Content' },
    { id: 'technical', label: 'Technical' },
    { id: 'local', label: 'Local' },
    { id: 'links', label: 'Links' },
    { id: 'strategy', label: 'Strategy' },
    { id: 'admin', label: 'Admin' },
] as const;

export type PlanLabelId = (typeof PLAN_LABELS)[number]['id'];

export const PLAN_TEXT_AUTOSAVE_MS = 500;
export const PLAN_TITLE_MAX = 300;

export type PlanPanelField = 'title' | 'due' | 'assignee';

export function isPlanLabel(value: string): value is PlanLabelId {
    return PLAN_LABELS.some(label => label.id === value);
}

export function planLabelText(id: string): string {
    return PLAN_LABELS.find(label => label.id === id)?.label ?? id;
}

/** Legacy rows stay readable. The select never offers review, approved, or blocked. */
export function displayPlanStatus(stored: string): PlanPanelStatus {
    if (stored === 'in_progress' || stored === 'review') return 'in_progress';
    if (stored === 'done' || stored === 'approved') return 'done';
    return 'todo';
}

export function readPlanLabels(
    category: string | null | undefined,
    tags: readonly string[] | null | undefined,
): string[] {
    const labels: string[] = [];
    const add = (value: string | null | undefined) => {
        const label = value?.trim() ?? '';
        if (!label || labels.includes(label)) return;
        labels.push(label);
    };
    if (category?.trim()) add(category.trim());
    for (const tag of tags ?? []) {
        if (isPlanLabel(tag)) add(tag);
    }
    return labels;
}

/**
 * Labels live in the columns that already exist.
 * `category` keeps the first label so other screens still see one.
 * `tags` keeps every selected label, plus any tag that is not a plan label.
 */
export function writePlanLabels(
    selected: readonly string[],
    existingTags: readonly string[] | null | undefined,
): { category: string | null; tags: string[] } {
    const next: string[] = [];
    const seen = new Set<string>();
    for (const label of selected) {
        const value = label.trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        next.push(value);
    }
    const kept = (existingTags ?? [])
        .map(tag => tag.trim())
        .filter(tag => tag && !isPlanLabel(tag) && !seen.has(tag));
    return { category: next[0] ?? null, tags: [...next, ...kept] };
}

export function togglePlanValue(selected: readonly string[], id: string): string[] {
    return selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
}

export function planTitleSave(next: string, saved: string): string | null {
    const title = next.trim().slice(0, PLAN_TITLE_MAX);
    if (!title || title === saved) return null;
    return title;
}

export function planDescriptionSave(next: string, saved: string): string | null {
    const description = next.replace(/\s+$/u, '');
    if (description === saved) return null;
    return description;
}

export interface PlanTextAutosave {
    draft: string;
    saved: string;
    dirty: boolean;
    dueAt: number | null;
}

export function queuePlanTextSave(
    state: PlanTextAutosave,
    draft: string,
    now: number,
    delayMs: number,
    parse: (draft: string, saved: string) => string | null,
): PlanTextAutosave {
    if (parse(draft, state.saved) == null) return { ...state, draft, dirty: false, dueAt: null };
    return { ...state, draft, dirty: true, dueAt: now + delayMs };
}

export function commitPlanTextSave(
    state: PlanTextAutosave,
    now: number,
    parse: (draft: string, saved: string) => string | null,
): { state: PlanTextAutosave; value: string | null } {
    if (!state.dirty || state.dueAt == null || now < state.dueAt) return { state, value: null };
    const value = parse(state.draft, state.saved);
    if (value == null) return { state: { ...state, dirty: false, dueAt: null }, value: null };
    return {
        value,
        state: { draft: state.draft, saved: value, dirty: false, dueAt: null },
    };
}

export function parsePlanEstimate(raw: string): { ok: true; hours: number | null } | { ok: false; error: string } {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, hours: null };
    const minutes = /^(\d+(?:\.\d+)?)\s*m$/i.exec(trimmed);
    const hoursMatch = minutes ? null : /^(\d+(?:\.\d+)?)\s*h?$/i.exec(trimmed);
    const match = minutes ?? hoursMatch;
    if (!match) return { ok: false, error: 'Enter hours, like 2 or 90m.' };
    const parsed = Number(match[1]);
    const hours = minutes ? parsed / 60 : parsed;
    if (!Number.isFinite(hours) || hours < 0 || hours > 1000) return { ok: false, error: 'Enter hours, like 2 or 90m.' };
    return { ok: true, hours: Math.round(hours * 100) / 100 };
}

export function formatPlanEstimateInput(hours: number | null | undefined): string {
    if (hours == null || !Number.isFinite(hours)) return '';
    return String(Math.round(hours * 100) / 100);
}

export function planLiveUrlSave(raw: string): { ok: true; publishedUrl: string | null } | { ok: false; error: string } {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, publishedUrl: null };
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return parseLiveUrlInput(withScheme);
}

export function planOnboardingStage(on: boolean): TaskStage {
    return on ? 'onboarding' : 'backlog';
}

export function planDuplicateTitle(title: string): string {
    const base = title.trim() || 'Task';
    const next = `${base} copy`;
    return next.length <= PLAN_TITLE_MAX ? next : next.slice(0, PLAN_TITLE_MAX).trim();
}

export function planTasksWithout(tasks: readonly StageListTask[], id: string): StageListTask[] {
    const drop = new Set<string>();
    const pending = [id];
    while (pending.length > 0) {
        const current = pending.pop();
        if (!current || drop.has(current)) continue;
        drop.add(current);
        for (const task of tasks) {
            if (task.parentTaskId === current) pending.push(task.id);
        }
    }
    return tasks.filter(task => !drop.has(task.id));
}

export interface PlanParentChoice {
    id: string;
    title: string;
}

export type PlanParentField =
    | { kind: 'pillar'; childCount: number }
    | { kind: 'locked'; currentTitle: string | null }
    | { kind: 'picker'; currentId: string | null; currentTitle: string | null; choices: PlanParentChoice[] };

function directChildren(tasks: readonly StageListTask[], taskId: string): StageListTask[] {
    return tasks.filter(task => task.parentTaskId === taskId && task.id !== taskId);
}

/** One level. A pillar stays put. A subtask can move under another top-level task, or to None. */
export function planParentField(tasks: readonly StageListTask[], taskId: string): PlanParentField {
    const task = tasks.find(item => item.id === taskId);
    if (!task) return { kind: 'picker', currentId: null, currentTitle: null, choices: [] };
    const childCount = directChildren(tasks, taskId).length;
    if (childCount > 0) return { kind: 'pillar', childCount };
    const current = task.parentTaskId ? tasks.find(item => item.id === task.parentTaskId) : undefined;
    if (task.recurring) return { kind: 'locked', currentTitle: current?.title ?? null };
    const choices = tasks
        .filter(item => item.id !== taskId && !item.parentTaskId && !isPendingStageTaskId(item.id))
        .map(item => ({ id: item.id, title: item.title }));
    return {
        kind: 'picker',
        currentId: current?.id ?? null,
        currentTitle: current?.title ?? null,
        choices,
    };
}

function siblingIndex(
    tasks: readonly StageListTask[],
    stage: TaskStage,
    parentTaskId: string | null,
    taskId: string,
): number {
    const groups = groupTasksByStage(tasks, '');
    if (parentTaskId) {
        for (const section of groups) {
            const group = section.groups.find(item => item.task.id === parentTaskId);
            if (group) return group.children.filter(child => child.id !== taskId).length;
        }
        return 0;
    }
    const section = groups.find(item => item.stage === stage);
    return (section?.groups ?? []).filter(group => group.task.id !== taskId).length;
}

export function planParentMove(
    tasks: readonly StageListTask[],
    taskId: string,
    parentTaskId: string | null,
): { ok: true; move: StageReorderMove | null } | { ok: false; error: string } {
    const task = tasks.find(item => item.id === taskId);
    if (!task) return { ok: false, error: 'That task is not on this plan.' };
    if ((task.parentTaskId ?? null) === parentTaskId) return { ok: true, move: null };
    const field = planParentField(tasks, taskId);
    if (field.kind === 'pillar') return { ok: false, error: 'A pillar stays with its subtasks.' };
    if (field.kind === 'locked') return { ok: false, error: 'That task cannot be nested.' };
    if (parentTaskId && !field.choices.some(choice => choice.id === parentTaskId)) {
        return { ok: false, error: 'Tasks can only nest one level deep.' };
    }
    const parent = parentTaskId ? tasks.find(item => item.id === parentTaskId) : undefined;
    const stage: TaskStage = parent
        ? (isTaskStage(parent.stage) ? parent.stage : 'backlog')
        : (task.stage === 'onboarding' ? 'onboarding' : 'backlog');
    const move: StageReorderMove = {
        taskId,
        stage,
        parentTaskId,
        index: siblingIndex(tasks, stage, parentTaskId, taskId),
    };
    const plan = applyStageReorder(tasks, move);
    if (!plan.ok) return { ok: false, error: plan.error };
    if (plan.writes.length === 0) return { ok: true, move: null };
    return { ok: true, move };
}

export function groupPlanTimeByMonth(
    entries: readonly { date: string; hours: number }[],
): { month: string; label: string; hours: number }[] {
    const totals = new Map<string, number>();
    for (const entry of entries) {
        const day = dueDay(entry.date);
        const hours = Number(entry.hours);
        if (!day || !Number.isFinite(hours) || hours === 0) continue;
        const month = day.slice(0, 7);
        totals.set(month, (totals.get(month) ?? 0) + hours);
    }
    return [...totals.entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
        .map(([month, hours]) => ({ month, label: planMonthTitle(month), hours }));
}

export function basecampTodoHref(
    accountId: string | null | undefined,
    projectId: number | null | undefined,
    todoId: number | null | undefined,
): string | null {
    const account = accountId?.trim() ?? '';
    if (!/^\d+$/.test(account)) return null;
    if (typeof projectId !== 'number' || !Number.isInteger(projectId) || projectId <= 0) return null;
    if (typeof todoId !== 'number' || !Number.isInteger(todoId) || todoId <= 0) return null;
    return `https://3.basecamp.com/${account}/buckets/${projectId}/todos/${todoId}`;
}

export function formatSyncedAgo(iso: string | null | undefined, now: Date): string | null {
    if (!iso) return null;
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return null;
    const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
    if (seconds < 45) return 'synced just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `synced ${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `synced ${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 14) return `synced ${days}d ago`;
    const day = dueDay(iso);
    return day ? `synced ${formatDueDay(day)}` : null;
}

export interface PlanBasecampLine {
    linked: boolean;
    label: string;
    href: string | null;
    synced: string | null;
}

export function planBasecampLine(input: {
    linked: boolean;
    href?: string | null;
    listName?: string | null;
    lastSyncedAt?: string | null;
    now: Date;
}): PlanBasecampLine {
    if (!input.linked) return { linked: false, label: 'Not in Basecamp', href: null, synced: null };
    const name = input.listName?.trim();
    const href = input.href?.trim() || null;
    return {
        linked: true,
        label: name ? `To-do in “${name}”` : 'To-do in Basecamp',
        href,
        synced: formatSyncedAgo(input.lastSyncedAt, input.now),
    };
}

export function formatPlanCreated(createdAt: string | null | undefined, by: string | null | undefined): string {
    const day = dueDay(createdAt);
    const when = day ? formatDueDay(day) : '';
    const who = by?.trim() ?? '';
    if (when && who) return `Created ${when} by ${who}`;
    if (when) return `Created ${when}`;
    if (who) return `Created by ${who}`;
    return 'Created';
}

export function planPanelDue(task: Pick<StageListTask, 'dueDate' | 'status' | 'completedAt'>, today: string): {
    text: string;
    late: boolean;
} {
    const formatted = formatPlanDue({
        id: '',
        title: '',
        stage: null,
        position: null,
        parentTaskId: null,
        createdAt: null,
        category: null,
        basecamp: false,
        recurring: false,
        ...task,
    }, today);
    return { text: formatted.text, late: formatted.late };
}

export interface PlanPanelPerson {
    id: string;
    name: string;
    initials: string;
}

export interface PlanPanelTask {
    id: string;
    title: string;
    description: string;
    detailsReady: boolean;
    status: string;
    dueDate: string | null;
    assigneeIds: string[];
    estimatedHours: number | null;
    loggedHours: number;
    category: string | null;
    tags: string[];
    stage: TaskStage;
    parentTaskId: string | null;
    childCount: number;
    publishedUrl: string | null;
    recurring: boolean;
    basecampLinked: boolean;
    basecampHref: string | null;
    basecampListName: string | null;
    lastSyncedAt: string | null;
    createdAt: string | null;
    createdByLabel: string | null;
    timeByMonth: { month: string; label: string; hours: number }[];
}

export function planPanelTask(input: {
    task: StageListTask;
    tasks: readonly StageListTask[];
    detail?: Pick<Task, 'id' | 'description' | 'estimatedHours' | 'tags' | 'createdBy' | 'basecampTodoId' | 'basecampProjectId' | 'lastSyncedAt'> | null;
    people?: readonly PlanPanelPerson[];
    accountId?: string | null;
    basecampListName?: string | null;
    logs?: readonly { taskId?: string; date: string; hours: number }[];
    loggedHours?: number;
}): PlanPanelTask {
    const ready = input.detail?.id === input.task.id;
    const detail = ready ? input.detail : null;
    const logs = (input.logs ?? []).filter(entry => entry.taskId === input.task.id);
    const loggedFromEntries = logs.reduce((sum, entry) => sum + (Number.isFinite(entry.hours) ? entry.hours : 0), 0);
    const creator = detail?.createdBy
        ? input.people?.find(person => person.id === detail.createdBy)
        : undefined;
    const todoId = detail?.basecampTodoId ?? null;
    const linked = Boolean(todoId) || (!detail && input.task.basecamp);
    return {
        id: input.task.id,
        title: input.task.title,
        description: detail?.description ?? '',
        detailsReady: ready,
        status: input.task.status,
        dueDate: input.task.dueDate ?? null,
        assigneeIds: input.task.assigneeIds ?? [],
        estimatedHours: detail ? (detail.estimatedHours ?? null) : null,
        loggedHours: input.loggedHours ?? loggedFromEntries,
        category: input.task.category,
        tags: detail?.tags ?? [],
        stage: input.task.stage === 'onboarding' ? 'onboarding' : 'backlog',
        parentTaskId: input.task.parentTaskId,
        childCount: directChildren(input.tasks, input.task.id).length,
        publishedUrl: input.task.publishedUrl ?? null,
        recurring: input.task.recurring,
        basecampLinked: linked,
        basecampHref: basecampTodoHref(input.accountId, detail?.basecampProjectId ?? null, todoId),
        basecampListName: input.basecampListName ?? null,
        lastSyncedAt: detail?.lastSyncedAt ?? null,
        createdAt: input.task.createdAt,
        createdByLabel: creator ? (creator.initials || creator.name) : null,
        timeByMonth: groupPlanTimeByMonth(logs),
    };
}

export type PlanPanelSave =
    | { field: 'title'; title: string }
    | { field: 'description'; description: string }
    | { field: 'dueDate'; dueDate: string | null }
    | { field: 'status'; status: PlanPanelStatus }
    | { field: 'assignees'; assigneeIds: string[] }
    | { field: 'estimate'; estimatedHours: number | null }
    | { field: 'labels'; category: string | null; tags: string[] }
    | { field: 'onboarding'; stage: TaskStage }
    | { field: 'parent'; parentTaskId: string | null }
    | { field: 'liveUrl'; publishedUrl: string | null };

export function mergePlanTask(task: StageListTask, data: Task): StageListTask {
    return {
        ...task,
        title: data.title,
        status: data.status,
        stage: data.stage ?? task.stage,
        parentTaskId: data.parentTaskId ?? null,
        category: data.category ?? null,
        publishedUrl: data.publishedUrl ?? null,
        dueDate: data.dueDate ?? null,
        completedAt: data.completedAt ?? null,
        assigneeIds: data.assigneeIds ?? [],
    };
}

/** Mark Done the way a check would: status done, and a completion time if it had none. */
export function completionForPlanStatus(
    status: PlanPanelStatus,
    current: Pick<StageListTask, 'status' | 'completedAt'>,
    now: string,
): string | null {
    if (status !== 'done') return null;
    if (isPlanDone(current.status) && current.completedAt) return current.completedAt;
    return now;
}

export interface PlanKeyInput {
    key: string;
    /** Modifier held, or focus is in a text field or an open menu. */
    blocked: boolean;
    panelOpen: boolean;
    focusedId: string | null;
    visibleIds: readonly string[];
}

export type PlanKeyAction =
    | { type: 'move'; taskId: string; panel: boolean }
    | { type: 'open'; taskId: string }
    | { type: 'close' }
    | { type: 'none' };

export function planPanelKeyAction(input: PlanKeyInput): PlanKeyAction {
    if (input.key === 'Escape') {
        if (input.blocked || !input.panelOpen) return { type: 'none' };
        return { type: 'close' };
    }
    if (input.blocked) return { type: 'none' };
    const ids = input.visibleIds.filter(Boolean);
    if (input.key === 'j' || input.key === 'k') {
        if (ids.length === 0) return { type: 'none' };
        const index = input.focusedId ? ids.indexOf(input.focusedId) : -1;
        const next = index < 0
            ? (input.key === 'j' ? ids[0] : ids[ids.length - 1])
            : input.key === 'j'
                ? ids[Math.min(ids.length - 1, index + 1)]
                : ids[Math.max(0, index - 1)];
        return { type: 'move', taskId: next, panel: input.panelOpen };
    }
    if (input.key === 'Enter') {
        if (!input.focusedId || !ids.includes(input.focusedId)) return { type: 'none' };
        return { type: 'open', taskId: input.focusedId };
    }
    return { type: 'none' };
}

/**
 * Single-key shortcuts stay off in a text field.
 * Escape still leaves a date or status control. A menu handles its own Escape.
 */
export function planShortcutBlocked(target: EventTarget | null, key: string): boolean {
    if (!target || typeof target !== 'object' || !('closest' in target)) return false;
    const element = target as Element;
    if (element.closest('[data-plan-menu]')) return true;
    const editable = element.closest('textarea, [contenteditable="true"]');
    const textInput = typeof HTMLInputElement !== 'undefined'
        && element instanceof HTMLInputElement
        && !['button', 'checkbox', 'radio', 'date', 'submit', 'reset'].includes(element.type);
    if (editable || textInput) return true;
    if (key === 'Escape') return false;
    return Boolean(element.closest('input, select'));
}

/** Rows on screen. Collapsed sections and folded done rows use the hidden attribute. */
export function visiblePlanRowIds(root: ParentNode): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    root.querySelectorAll('[data-plan-row]').forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.closest('[hidden]')) return;
        const id = node.getAttribute('data-plan-row');
        if (!id || seen.has(id)) return;
        seen.add(id);
        ids.push(id);
    });
    return ids;
}

export function planDeleteCopy(childCount: number): string {
    if (childCount === 1) return 'Delete this pillar and its subtask?';
    if (childCount > 1) return `Delete this pillar and its ${childCount} subtasks?`;
    return 'Delete this task?';
}

export { formatPlanHours };

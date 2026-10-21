import type { PlanPanelSave } from './plan-panel';
import { isPendingStageTaskId } from './stage-add';
import type { StageListTask } from './stage-list';
import type { Task } from '../types';

/**
 * Panel writes for one task.
 * Each field has its own ticket. A response applies only while it is still
 * the latest write of that field, and it copies only the columns that field
 * owns. A slower description save cannot put an older status or estimate back.
 */
export interface PanelSaveLedger {
    seq: number;
    latest: Record<string, number>;
    openByTask: Record<string, number>;
}

export function emptyPanelSaveLedger(): PanelSaveLedger {
    return { seq: 0, latest: {}, openByTask: {} };
}

function fieldKey(taskId: string, field: string): string {
    return `${taskId}:${field}`;
}

export function beginPanelSave(
    ledger: PanelSaveLedger,
    taskId: string,
    field: string,
): { ledger: PanelSaveLedger; ticket: number } {
    const ticket = ledger.seq + 1;
    return {
        ticket,
        ledger: {
            seq: ticket,
            latest: { ...ledger.latest, [fieldKey(taskId, field)]: ticket },
            openByTask: { ...ledger.openByTask, [taskId]: (ledger.openByTask[taskId] ?? 0) + 1 },
        },
    };
}

export function panelSaveIsCurrent(ledger: PanelSaveLedger, taskId: string, field: string, ticket: number): boolean {
    return ledger.latest[fieldKey(taskId, field)] === ticket;
}

export function finishPanelSave(ledger: PanelSaveLedger, taskId: string): PanelSaveLedger {
    const open = (ledger.openByTask[taskId] ?? 1) - 1;
    const openByTask = { ...ledger.openByTask };
    if (open <= 0) delete openByTask[taskId];
    else openByTask[taskId] = open;
    return { ...ledger, openByTask };
}

export function panelTaskIsDirty(ledger: PanelSaveLedger, taskId: string): boolean {
    return (ledger.openByTask[taskId] ?? 0) > 0;
}

export function dirtyPanelTaskIds(ledger: PanelSaveLedger): ReadonlySet<string> {
    return new Set(Object.keys(ledger.openByTask));
}

type SaveField = Exclude<PlanPanelSave['field'], 'parent'>;

/** Copy one saved field onto the list row. Other columns stay as the list has them. */
export function mergeListField(task: StageListTask, saved: Task, field: SaveField): StageListTask {
    switch (field) {
        case 'title':
            return { ...task, title: saved.title };
        case 'description':
            return { ...task, description: saved.description ?? '' };
        case 'dueDate':
            return { ...task, dueDate: saved.dueDate ?? null };
        case 'status':
            return {
                ...task,
                status: saved.status,
                completedAt: saved.completedAt ?? null,
                blockedReason: saved.blockedReason?.trim() ? saved.blockedReason.trim() : null,
            };
        case 'assignees':
            return { ...task, assigneeIds: saved.assigneeIds ?? [] };
        case 'estimate':
            return { ...task, estimatedHours: saved.estimatedHours ?? null };
        case 'labels':
            return { ...task, category: saved.category ?? null };
        case 'blocked':
            return { ...task, blockedReason: saved.blockedReason?.trim() ? saved.blockedReason.trim() : null };
        case 'onboarding':
            return { ...task, stage: saved.stage ?? task.stage };
        case 'liveUrl':
            return { ...task, publishedUrl: saved.publishedUrl ?? null };
        default:
            return task;
    }
}

/** Put one field back after its own save fails. A newer edit of another field stays. */
export function restoreListField(task: StageListTask, snapshot: StageListTask, field: SaveField): StageListTask {
    switch (field) {
        case 'title':
            return { ...task, title: snapshot.title };
        case 'description':
            return { ...task, description: snapshot.description };
        case 'dueDate':
            return { ...task, dueDate: snapshot.dueDate };
        case 'status':
            return {
                ...task,
                status: snapshot.status,
                completedAt: snapshot.completedAt,
                blockedReason: snapshot.blockedReason,
            };
        case 'assignees':
            return { ...task, assigneeIds: snapshot.assigneeIds };
        case 'estimate':
            return { ...task, estimatedHours: snapshot.estimatedHours };
        case 'labels':
            return { ...task, category: snapshot.category };
        case 'blocked':
            return { ...task, blockedReason: snapshot.blockedReason };
        case 'onboarding':
            return { ...task, stage: snapshot.stage };
        case 'liveUrl':
            return { ...task, publishedUrl: snapshot.publishedUrl };
        default:
            return task;
    }
}

/** Copy one saved field onto the open detail. A full row from an older request is not installed. */
export function mergeDetailField(current: Task, saved: Task, field: SaveField): Task {
    const updatedAt = saved.updatedAt ?? current.updatedAt;
    switch (field) {
        case 'title':
            return { ...current, title: saved.title, updatedAt };
        case 'description':
            return { ...current, description: saved.description ?? '', updatedAt };
        case 'dueDate':
            return { ...current, dueDate: saved.dueDate, updatedAt };
        case 'status':
            return {
                ...current,
                status: saved.status,
                completedAt: saved.completedAt,
                blockedReason: saved.blockedReason,
                updatedAt,
            };
        case 'assignees':
            return { ...current, assigneeIds: saved.assigneeIds ?? [], updatedAt };
        case 'estimate':
            return { ...current, estimatedHours: saved.estimatedHours ?? undefined, updatedAt };
        case 'labels':
            return { ...current, category: saved.category, tags: saved.tags ?? [], updatedAt };
        case 'blocked':
            return { ...current, blockedReason: saved.blockedReason, updatedAt };
        case 'onboarding':
            return { ...current, stage: saved.stage, updatedAt };
        case 'liveUrl':
            return { ...current, publishedUrl: saved.publishedUrl, updatedAt };
        default:
            return current;
    }
}

/**
 * A stage-list reload arrived while edits were in flight.
 * Pending creates stay. A dirty row keeps the fields the panel is writing.
 */
export function mergeRefreshedTasks(
    local: readonly StageListTask[] | null,
    fresh: readonly StageListTask[],
    dirtyIds: ReadonlySet<string>,
): StageListTask[] {
    if (!local) return [...fresh];
    const previous = new Map(local.map(task => [task.id, task]));
    const merged = fresh.map(row => {
        const kept = previous.get(row.id);
        if (!kept || !dirtyIds.has(row.id)) return row;
        return {
            ...row,
            title: kept.title,
            description: kept.description ?? row.description,
            status: kept.status,
            stage: kept.stage,
            dueDate: kept.dueDate,
            completedAt: kept.completedAt,
            assigneeIds: kept.assigneeIds,
            estimatedHours: kept.estimatedHours ?? row.estimatedHours,
            category: kept.category,
            blockedReason: kept.blockedReason,
            publishedUrl: kept.publishedUrl,
            parentTaskId: kept.parentTaskId,
        };
    });
    const seen = new Set(merged.map(task => task.id));
    const pending = local.filter(task => isPendingStageTaskId(task.id) && !seen.has(task.id));
    return [...merged, ...pending];
}

import { readInitiativeCategory, type InitiativeDraft, type InitiativeState } from '../campaign-workspace/initiatives';

export const PROJECT_STATUS = {
    planned: { label: 'Planned', tone: 'bg-muted text-muted-foreground' },
    in_progress: { label: 'In progress', tone: 'bg-blue-100 text-blue-800' },
    awaiting_approval: { label: 'Waiting on approval', tone: 'bg-amber-100 text-amber-800' },
    blocked: { label: 'Blocked', tone: 'bg-red-100 text-red-800' },
    on_hold: { label: 'On hold', tone: 'bg-muted text-muted-foreground' },
    completed_verified: { label: 'Completed and verified', tone: 'bg-emerald-100 text-emerald-800' },
} satisfies Record<InitiativeState, { label: string; tone: string }>;

interface ProjectTask {
    id: string;
    initiativeId?: string | null;
    parentTaskId?: string | null;
}

function isProjectRoot(projectId: string, task: ProjectTask) {
    return !task.parentTaskId && task.initiativeId === projectId;
}

export function filterProjectTasks<T extends ProjectTask>(projectId: string, tasks: readonly T[]): T[] {
    const children = new Map<string, string[]>();
    const pending: string[] = [];
    for (const task of tasks) {
        if (isProjectRoot(projectId, task)) pending.push(task.id);
        if (!task.parentTaskId) continue;
        const siblings = children.get(task.parentTaskId) ?? [];
        siblings.push(task.id);
        children.set(task.parentTaskId, siblings);
    }
    const included = new Set<string>();
    for (const id of pending) {
        if (included.has(id)) continue;
        included.add(id);
        for (const child of children.get(id) ?? []) pending.push(child);
    }
    return tasks.filter(task => included.has(task.id));
}

export function projectProgress(
    projectId: string,
    tasks: readonly (ProjectTask & { status: string; dueDate?: string | null })[],
) {
    let total = 0;
    let done = 0;
    let nextDue: string | null = null;
    for (const task of tasks) {
        if (!isProjectRoot(projectId, task)) continue;
        total++;
        if (task.status === 'done') done++;
        else if (task.dueDate && (!nextDue || task.dueDate < nextDue)) nextDue = task.dueDate;
    }
    return { done, total, nextDue };
}

export function buildProjectDraft(name: string, categoryValue: string): InitiativeDraft {
    const title = name.trim();
    if (!title) throw new Error('Project name is required.');
    if (title.length > 160) throw new Error('Project name is too long.');
    const category = readInitiativeCategory(categoryValue);
    if (!category) throw new Error('Choose a project category.');
    return {
        title, category, state: 'planned', priority: '2',
        purpose: '', ownerName: '', phase: '', targetMonth: '', startsOn: '', endsOn: '',
        pageUrl: '', successMetricLabel: '', evidenceUrl: '', verifiedOn: '', items: [],
    };
}

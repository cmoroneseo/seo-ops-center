import { ROADMAP_PHASES, type RoadmapPhase } from '../marketing-plan-roadmap';
import { MARKETING_PLAN_STEPS } from '../marketing-plan-template';
import { basecampTodoHref } from '../seo-plan/plan-panel';
import { formatPacificTime } from './time';

export const ROADMAP_TAB = 'App – Roadmap';
export const TASKS_TAB = 'App – SEO Plan tasks';
export const INFO_TAB = 'App – Sync info';

export interface RoadmapRow {
    id: string;
    title: string;
    step_key: string;
    status: string;
    priority: string;
    due_date: string | null;
    roadmap_phase: RoadmapPhase | null;
    roadmap_included: boolean;
    sort_order: number;
    task_id: string | null;
    updated_at: string;
}

export interface TaskRow {
    id: string;
    title: string;
    parent_task_id: string | null;
    category: string | null;
    status: string | null;
    start_date: string | null;
    due_date: string | null;
    completed_at: string | null;
    published_url: string | null;
    basecamp_project_id: number | null;
    basecamp_todo_id: number | null;
}

export interface MirrorData {
    roadmap: RoadmapRow[];
    tasks: TaskRow[];
    now: Date;
    basecampAccountId?: string;
}

export interface MirrorTab {
    title: string;
    rows: string[][];
}

const zone = 'America/Los_Angeles';
const dateFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
});
function date(value: string | null): string {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? dateFormat.format(parsed) : '';
}

function parentsFirst(tasks: TaskRow[], byId: Map<string, TaskRow>): TaskRow[] {
    const visited = new Set<string>();
    const ordered: TaskRow[] = [];
    for (const task of tasks) {
        const chain: TaskRow[] = [];
        let current: TaskRow | undefined = task;
        while (current && !visited.has(current.id)) {
            visited.add(current.id);
            chain.push(current);
            current = current.parent_task_id ? byId.get(current.parent_task_id) : undefined;
        }
        ordered.push(...chain.reverse());
    }
    return ordered;
}

export function buildMirror(data: MirrorData): { tabs: MirrorTab[] } {
    const tasks = new Map(data.tasks.map(task => [task.id, task]));
    const steps = new Map(MARKETING_PLAN_STEPS.map(step => [step.key, step.name]));
    const roadmapRows = ROADMAP_PHASES.flatMap(([phase, label]) => data.roadmap
        .filter(item => item.roadmap_included && (item.roadmap_phase ?? 'backlog') === phase)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(item => [
            label, item.title, steps.get(item.step_key) ?? '', item.status, item.priority, date(item.due_date),
            tasks.get(item.task_id ?? '')?.status ?? '', date(item.updated_at), item.id,
        ]));
    const taskRows = parentsFirst(data.tasks, tasks).map(task => [
        task.title, tasks.get(task.parent_task_id ?? '')?.title ?? '', task.category ?? '',
        task.status ?? '', date(task.start_date), date(task.due_date), date(task.completed_at), task.published_url ?? '',
        basecampTodoHref(data.basecampAccountId, task.basecamp_project_id, task.basecamp_todo_id) ?? '', task.id,
    ]);
    const infoRows = [
        ['Last synced (PT)', formatPacificTime(data.now)],
        [`Rows written – ${ROADMAP_TAB}`, String(roadmapRows.length)],
        [`Rows written – ${TASKS_TAB}`, String(taskRows.length)],
        ['Note', 'This tab group is overwritten by SEO Ops Center. Edit in the app, not here.'],
    ];
    infoRows.splice(3, 0, [`Rows written – ${INFO_TAB}`, String(infoRows.length + 1)]);
    return { tabs: [
        { title: ROADMAP_TAB, rows: [
            ['Phase', 'Initiative', 'Category', 'Status', 'Priority', 'Due date', 'Linked task status', 'Last updated', 'App ID'],
            ...roadmapRows,
        ] },
        { title: TASKS_TAB, rows: [
            ['Title', 'Parent task', 'Category', 'Status', 'Start date', 'Due date', 'Completed date', 'Published URL', 'Basecamp link', 'App ID'],
            ...taskRows,
        ] },
        { title: INFO_TAB, rows: [['Key', 'Value'], ...infoRows] },
    ] };
}

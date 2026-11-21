import { completionDay } from '../seo-plan/plan-sections';
import { groupTasksByProject, NO_PROJECT_GROUP } from '../seo-plan/project-groups';
import { STAGE_LIST_TIME_ZONE, formatDueDay } from '../seo-plan/this-month';
import type { StageListTask } from '../seo-plan/stage-list';
import type { CampaignInitiative, InitiativeState } from '../campaign-workspace/initiatives';

/** The only keys a client roadmap object may carry. */
export const CLIENT_ROADMAP_KEYS = ['groups'] as const;

/** The only keys a group may carry. */
export const CLIENT_ROADMAP_GROUP_KEYS = ['title', 'status', 'done', 'total', 'progress', 'tasks'] as const;

/** The only keys a task may carry. `doneOn` and `description` are optional. */
export const CLIENT_ROADMAP_TASK_KEYS = ['title', 'status', 'doneOn', 'description'] as const;

export const CLIENT_STATUS_WORDS = {
    notStarted: 'Not started',
    inProgress: 'In progress',
    done: 'Done',
    inReview: 'In review',
} as const;

export const ROADMAP_COPY = {
    title: 'Roadmap',
    libraryDescription: 'Current progress on the work plan, by project.',
    empty: 'No work has been planned yet.',
    otherWork: 'Other work',
    nothingHere: 'Nothing here yet',
    chooseClient: 'Choose a client to see the roadmap.',
    loading: 'Loading the roadmap…',
    error: 'The roadmap could not be loaded. Refresh the page to try again.',
    showDescriptions: 'Show task descriptions',
    descriptionsHelp: 'Task descriptions are internal notes; only turn this on if they are written for the client.',
} as const;

const STATUS_WORDS: Record<string, string> = {
    todo: CLIENT_STATUS_WORDS.notStarted,
    in_progress: CLIENT_STATUS_WORDS.inProgress,
    done: CLIENT_STATUS_WORDS.done,
    review: CLIENT_STATUS_WORDS.inReview,
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const HOURS = /\b\d+(?:\.\d+)?\s*(?:hours?|hrs?)\b|\b\d+(?:\.\d+)?h\b/i;

const PROJECT_STATUS_LABELS: Record<InitiativeState, string> = {
    planned: 'Planned',
    in_progress: 'In progress',
    awaiting_approval: 'Waiting on your approval',
    blocked: 'Blocked',
    on_hold: 'On hold',
    completed_verified: 'Done',
};

export type RoadmapProject = Pick<CampaignInitiative, 'id' | 'title' | 'state'>;

export interface ClientRoadmapTask {
    title: string;
    status: string;
    doneOn?: string;
    description?: string;
}

export interface ClientRoadmapGroup {
    title: string;
    status?: string;
    done: number;
    total: number;
    progress: string;
    tasks: ClientRoadmapTask[];
}

export interface ClientRoadmap {
    groups: ClientRoadmapGroup[];
}

/** Older roadmap payloads can still be displayed by the report renderer. */
export type ClientRoadmapInput = ClientRoadmap | {
    stages: (Omit<ClientRoadmapGroup, 'status'> & { id?: string; description?: string })[];
};

export interface RoadmapBlockOptions {
    showTaskDescriptions: boolean;
}

export function clientStatusWord(status: string): string {
    return STATUS_WORDS[status] ?? CLIENT_STATUS_WORDS.notStarted;
}

function progressLabel(done: number, total: number): string {
    if (total === 0) return ROADMAP_COPY.nothingHere;
    return `${done} of ${total} done`;
}

export function doneOnLabel(day: string): string {
    return `Done on ${day}`;
}

/** A description a client may read. Emails and hour estimates are not safe. */
export function clientSafeDescription(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text) return null;
    if (EMAIL.test(text)) {
        EMAIL.lastIndex = 0;
        return null;
    }
    EMAIL.lastIndex = 0;
    if (HOURS.test(text)) return null;
    return text;
}

function withoutEmails(value: string, fallback = 'Task'): string {
    const cleaned = value.replace(EMAIL, '').replace(/\s{2,}/g, ' ').trim();
    EMAIL.lastIndex = 0;
    return cleaned || fallback;
}

function projectTask(task: StageListTask): ClientRoadmapTask {
    const status = clientStatusWord(task.status);
    const row: ClientRoadmapTask = {
        title: withoutEmails(task.title.trim()),
        status,
    };
    if (status === CLIENT_STATUS_WORDS.done) {
        const day = completionDay(task.completedAt, STAGE_LIST_TIME_ZONE);
        if (day) row.doneOn = formatDueDay(day);
    }
    const description = clientSafeDescription(task.description);
    if (description) row.description = description;
    return row;
}

/** Progress counts the main tasks listed in each project. */
export function projectClientRoadmap(input: {
    projects: readonly RoadmapProject[];
    tasks: readonly StageListTask[];
}): ClientRoadmap {
    const projectsById = new Map(input.projects.map(project => [project.id, project]));
    const groups: ClientRoadmapGroup[] = [];
    for (const section of groupTasksByProject(input.tasks, input.projects)) {
        const project = projectsById.get(section.id);
        const tasks = section.groups.filter(({ parentBreadcrumb }) => !parentBreadcrumb)
            .map(({ task }) => projectTask(task));
        if (section.id === NO_PROJECT_GROUP && tasks.length === 0) continue;

        const done = tasks.filter(task => task.status === CLIENT_STATUS_WORDS.done).length;
        groups.push({
            title: project ? withoutEmails(project.title.trim(), 'Project') : ROADMAP_COPY.otherWork,
            ...(project ? { status: PROJECT_STATUS_LABELS[project.state] } : {}),
            done,
            total: tasks.length,
            progress: progressLabel(done, tasks.length),
            tasks,
        });
    }
    return { groups };
}

/** True when other report content follows the Roadmap block, so it is not the last section. */
export function roadmapBeforeFollowingContent(blocks: readonly { type: string }[]): boolean {
    const index = blocks.findIndex(block => block.type === 'roadmap');
    if (index < 0) return false;
    return blocks.slice(index + 1).some(block => block.type !== 'page_break');
}

export function readRoadmapBlockOptions(props: unknown): RoadmapBlockOptions {
    const record = props && typeof props === 'object' ? props as Record<string, unknown> : {};
    return { showTaskDescriptions: record.showTaskDescriptions === true };
}

/** Display options stored on the block. Task rows are not stored here. */
export function clientRoadmapProps(
    props: Record<string, unknown> | null | undefined,
    mode: 'editor' | 'client' = 'client',
): Record<string, unknown> {
    const options = readRoadmapBlockOptions(props);
    const out: Record<string, unknown> = {};
    if (options.showTaskDescriptions) out.showTaskDescriptions = true;
    if (mode === 'editor' && props?.settingsOpen === true) out.settingsOpen = true;
    return out;
}

function roadmapGroups(roadmap: ClientRoadmapInput): readonly ClientRoadmapGroup[] {
    return 'groups' in roadmap ? roadmap.groups : roadmap.stages;
}

export function roadmapHasClientDescriptions(roadmap: ClientRoadmapInput): boolean {
    return roadmapGroups(roadmap).some(group => group.tasks.some(task => Boolean(task.description)));
}

/** Project both current and legacy payloads onto the client allow-list. */
export function presentRoadmap(roadmap: ClientRoadmapInput, options: RoadmapBlockOptions): ClientRoadmap {
    return {
        groups: roadmapGroups(roadmap).map(group => ({
            title: withoutEmails(group.title, 'Project'),
            ...(group.status ? { status: group.status } : {}),
            done: group.done,
            total: group.total,
            progress: group.progress,
            tasks: group.tasks.map(task => {
                const description = options.showTaskDescriptions ? clientSafeDescription(task.description) : null;
                return {
                    title: withoutEmails(task.title),
                    status: task.status,
                    ...(task.doneOn ? { doneOn: task.doneOn } : {}),
                    ...(description ? { description } : {}),
                };
            }),
        })),
    };
}

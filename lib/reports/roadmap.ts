/**
 * Client-safe roadmap for a report.
 * Built from the work-plan stage list. Subtasks, hours, notes, and
 * assignee details never leave this function.
 */

import { PHASE_STAGE_COPY, groupTasksByPhase, type PlanBoard, type PlanPhase } from '../seo-plan/plan-phases';
import { completionDay, groupTasksByPlanMonth, monthKeyFromDay, type PlanSectionId } from '../seo-plan/plan-sections';
import { STAGE_LIST_TIME_ZONE, calendarDay, formatDueDay } from '../seo-plan/this-month';
import type { StageListTask } from '../seo-plan/stage-list';

export const ROADMAP_STAGE_IDS = [
    'foundation',
    'growth',
    'scale',
    'onboarding',
    'this_month',
    'backlog',
] as const;

export type RoadmapStageId = (typeof ROADMAP_STAGE_IDS)[number];

/** The only keys a client roadmap object may carry. */
export const CLIENT_ROADMAP_KEYS = ['stages'] as const;

/** The only keys a stage may carry. */
export const CLIENT_ROADMAP_STAGE_KEYS = ['id', 'title', 'description', 'done', 'total', 'progress', 'tasks'] as const;

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
    libraryDescription: 'Current progress on the work plan, by stage.',
    empty: 'No work has been planned yet.',
    stageEmpty: 'Nothing in this stage yet.',
    nothingHere: 'Nothing here yet',
    noStages: 'No stages are selected for this report.',
    chooseClient: 'Choose a client to see the roadmap.',
    loading: 'Loading the roadmap…',
    error: 'The roadmap could not be loaded. Refresh the page to try again.',
    showDescriptions: 'Show task descriptions',
    stagesToShow: 'Stages to show',
    descriptionsHelp: 'Task descriptions are internal notes; only turn this on if they are written for the client.',
    later: 'Later',
    monthOnboarding: 'The setup we do at the start.',
    monthThisMonth: 'The work planned for this month.',
    monthBacklog: 'Work we will get to later.',
} as const;

const STATUS_WORDS: Record<string, string> = {
    todo: CLIENT_STATUS_WORDS.notStarted,
    in_progress: CLIENT_STATUS_WORDS.inProgress,
    done: CLIENT_STATUS_WORDS.done,
    review: CLIENT_STATUS_WORDS.inReview,
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const HOURS = /\b\d+(?:\.\d+)?\s*(?:hours?|hrs?)\b|\b\d+(?:\.\d+)?h\b/i;

const MONTH_STAGE_COPY: Record<PlanSectionId, { description: string }> = {
    onboarding: { description: ROADMAP_COPY.monthOnboarding },
    this_month: { description: ROADMAP_COPY.monthThisMonth },
    backlog: { description: ROADMAP_COPY.monthBacklog },
};

export interface ClientRoadmapTask {
    title: string;
    status: string;
    doneOn?: string;
    description?: string;
}

export interface ClientRoadmapStage {
    id: RoadmapStageId;
    title: string;
    description: string;
    done: number;
    total: number;
    progress: string;
    tasks: ClientRoadmapTask[];
}

export interface ClientRoadmap {
    stages: ClientRoadmapStage[];
}

export interface RoadmapBlockOptions {
    hiddenStages: RoadmapStageId[];
    showTaskDescriptions: boolean;
}

export function clientStatusWord(status: string): string {
    return STATUS_WORDS[status] ?? CLIENT_STATUS_WORDS.notStarted;
}

export function stageProgressLabel(done: number, total: number): string {
    if (total === 0) return ROADMAP_COPY.nothingHere;
    return `${done} of ${total} done`;
}

export function doneOnLabel(day: string): string {
    return `Done on ${day}`;
}

export function monthStageDescription(id: PlanSectionId, title: string): string {
    if (id === 'this_month' && title !== 'This month') return `The work planned for ${title}.`;
    return MONTH_STAGE_COPY[id].description;
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

function withoutEmails(value: string): string {
    const cleaned = value.replace(EMAIL, '').replace(/\s{2,}/g, ' ').trim();
    EMAIL.lastIndex = 0;
    return cleaned || 'Task';
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

function clientTasks(groups: readonly { task: StageListTask; parentBreadcrumb?: string }[]): StageListTask[] {
    return groups.filter(group => !group.parentBreadcrumb).map(group => group.task);
}

function stageFromTasks(
    id: RoadmapStageId,
    title: string,
    description: string,
    tasks: readonly StageListTask[],
): ClientRoadmapStage {
    const projected = tasks.map(projectTask);
    const done = projected.filter(task => task.status === CLIENT_STATUS_WORDS.done).length;
    return {
        id,
        title,
        description,
        done,
        total: projected.length,
        progress: stageProgressLabel(done, projected.length),
        tasks: projected,
    };
}

/**
 * Group the stage-list board into the stages a client can see.
 * Progress counts the tasks that are listed. Subtasks are not listed.
 */
export function projectClientRoadmap(input: {
    board: PlanBoard;
    tasks: readonly StageListTask[];
    today: string;
}): ClientRoadmap {
    if (input.board === 'phases') {
        const sections = groupTasksByPhase(input.tasks, '', input.today);
        return {
            stages: sections.map(section => stageFromTasks(
                section.id,
                PHASE_STAGE_COPY[section.id as PlanPhase].title,
                PHASE_STAGE_COPY[section.id as PlanPhase].description,
                clientTasks(section.groups),
            )),
        };
    }
    const month = monthKeyFromDay(input.today);
    const sections = groupTasksByPlanMonth(input.tasks, {
        month,
        today: input.today,
        timeZone: STAGE_LIST_TIME_ZONE,
    });
    return {
        stages: sections.map(section => stageFromTasks(
            section.id,
            section.id === 'backlog' ? ROADMAP_COPY.later : section.title,
            monthStageDescription(section.id, section.title),
            clientTasks(section.groups),
        )),
    };
}

/** True when other report content follows the Roadmap block, so it is not the last section. */
export function roadmapBeforeFollowingContent(blocks: readonly { type: string }[]): boolean {
    const index = blocks.findIndex(block => block.type === 'roadmap');
    if (index < 0) return false;
    return blocks.slice(index + 1).some(block => block.type !== 'page_break');
}

export function isRoadmapStageId(value: unknown): value is RoadmapStageId {
    return typeof value === 'string' && (ROADMAP_STAGE_IDS as readonly string[]).includes(value);
}

export function readRoadmapBlockOptions(props: unknown): RoadmapBlockOptions {
    const record = props && typeof props === 'object' ? props as Record<string, unknown> : {};
    const hidden = Array.isArray(record.hiddenStages)
        ? record.hiddenStages.filter(isRoadmapStageId)
        : [];
    return {
        hiddenStages: [...new Set(hidden)],
        showTaskDescriptions: record.showTaskDescriptions === true,
    };
}

/** Display options stored on the block. Task rows are not stored here. */
export function clientRoadmapProps(
    props: Record<string, unknown> | null | undefined,
    mode: 'editor' | 'client' = 'client',
): Record<string, unknown> {
    const options = readRoadmapBlockOptions(props);
    const out: Record<string, unknown> = {};
    if (options.hiddenStages.length > 0) out.hiddenStages = options.hiddenStages;
    if (options.showTaskDescriptions) out.showTaskDescriptions = true;
    if (mode === 'editor' && props?.settingsOpen === true) out.settingsOpen = true;
    return out;
}

export function roadmapHasClientDescriptions(roadmap: ClientRoadmap): boolean {
    return roadmap.stages.some(stage => stage.tasks.some(task => Boolean(task.description)));
}

/** Hide stages, and hide descriptions unless the report asked to show them. */
export function presentRoadmap(roadmap: ClientRoadmap, options: RoadmapBlockOptions): ClientRoadmap {
    const hidden = new Set(options.hiddenStages);
    return {
        stages: roadmap.stages.filter(stage => !hidden.has(stage.id)).map(stage => ({
            ...stage,
            tasks: stage.tasks.map(task => {
                if (options.showTaskDescriptions || !task.description) return task;
                return { title: task.title, status: task.status, ...(task.doneOn ? { doneOn: task.doneOn } : {}) };
            }),
        })),
    };
}

export function roadmapIsEmpty(roadmap: ClientRoadmap): boolean {
    return roadmap.stages.every(stage => stage.total === 0);
}

export function todayForRoadmap(now = new Date()): string {
    return calendarDay(now, STAGE_LIST_TIME_ZONE);
}

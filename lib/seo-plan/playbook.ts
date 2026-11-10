import { MARKETING_PLAN_STEPS, MARKETING_PLAN_TEMPLATE_ITEMS } from '../marketing-plan-template';
import { catalogAddBlocked, onboardingChecklist } from './onboarding';
import { drawerWording } from './playbook-plain';
import { endOfMonthDay } from './plan-add';
import { PHASE_STAGE_COPY, PLAN_PHASES, type BoardStage, type PlanBoard } from './plan-phases';
import { monthKeyFromDay, planMonthTitle } from './plan-sections';
import { STAGE_ADD_MAX_TITLE_LENGTH, STAGE_ADD_MAX_TITLES } from './stage-add-lines';

/**
 * Saved tasks a person can add to a work plan.
 * The rows come from the checklist, the saved work list, and tasks the
 * organization already saved. Template keys stay the stored keys.
 * The drawer shows plain wording for those saved tasks.
 * A row whose work is already on the plan is marked and left out of the add.
 */

export const PLAYBOOK_COPY = {
    button: 'Add from a playbook',
    title: 'Add from a playbook',
    intro: 'Choose saved tasks, pick the stage they belong in, and add them to this plan.',
    search: 'Search saved tasks',
    noMatch: 'No saved tasks match that search.',
    already: 'Already in the plan',
    same: 'Same as a task you picked',
    stage: 'Add these tasks to',
    addNone: 'Add tasks',
    adding: 'Adding…',
    close: 'Close',
    selectAll: 'Select all',
    clear: 'Clear',
    emptyHint: 'You can also choose saved tasks with Add from a playbook.',
    loading: 'Loading your saved tasks…',
    error: 'Could not add those tasks. Try again.',
    partial: 'Some tasks were added. The rest could not be added. Try again.',
    checklist: 'Starting checklist',
    library: 'Saved work list',
    saved: 'Your saved tasks',
    onboardingDetail: 'Starting tasks for a new client.',
    backlogDetail: 'Tasks with no date yet.',
    thisMonthDetail: 'Tasks due at the end of this month.',
} as const;

/** Plain names for the saved work list groups. Keys match the existing list. */
export const PLAYBOOK_GROUP_TITLES: Record<string, string> = {
    setup: 'Getting started',
    technical: 'Fixing the site',
    research: 'Finding what people search for',
    content: 'Pages and articles',
    onpage: 'Improving each page',
    links: 'Links from other sites',
    local: 'Showing up nearby',
};

export function playbookStageButtonLabel(stageTitle: string): string {
    return `${PLAYBOOK_COPY.button} to ${stageTitle}`;
}

export function playbookAddLabel(count: number): string {
    if (count === 1) return 'Add 1 task';
    return `Add ${count} tasks`;
}

export function playbookMonthDetail(month: string, today: string): string {
    if (month === monthKeyFromDay(today)) return PLAYBOOK_COPY.thisMonthDetail;
    return `Tasks due at the end of ${planMonthTitle(month)}.`;
}

export interface PlaybookOrgTask {
    id: string;
    title: string;
    description?: string;
}

export interface PlaybookItem {
    id: string;
    /** Wording shown in the drawer, and the title written when the task is added. */
    title: string;
    description: string;
    templateKey?: string;
    /**
     * Catalog title before drawer wording.
     * Tasks added before the wording change still use this title.
     */
    sourceTitle?: string;
}

export interface PlaybookGroup {
    id: string;
    title: string;
    items: PlaybookItem[];
}

export interface PlaybookSection {
    id: string;
    title: string;
    groups: PlaybookGroup[];
}

export interface PlaybookScope {
    gbp?: boolean;
    listings?: boolean;
}

export interface PlaybookExisting {
    title: string;
    templateKey?: string | null;
    /** Ignored checklist rows are not treated as work still on the plan. */
    status?: string | null;
    /** Excluded tasks are not treated as work still on the plan. */
    excluded?: boolean;
    /**
     * Checklist rows left off the roadmap are not on the plan.
     * Absent means the row was not a roadmap choice.
     */
    roadmapIncluded?: boolean;
}

export type PlaybookRowState = 'plan' | 'same' | 'open' | 'chosen';

export interface PlaybookChoice {
    id: string;
    label: string;
    detail: string;
    stage: BoardStage;
    dueDate: string | null;
}

export interface PlaybookAddCall {
    stage: BoardStage;
    titles: string[];
    dueDate?: string | null;
    items?: { title: string; depth: 0 | 1 }[];
}

export function playbookGroupTitle(stepKey: string, fallback: string): string {
    return PLAYBOOK_GROUP_TITLES[stepKey] ?? fallback;
}

function libraryItem(stepKey: string, index: number, title: string, description: string, templateKey?: string): PlaybookItem {
    const shown = drawerWording(title, description);
    return {
        id: `library:${stepKey}:${index}`,
        title: shown.title,
        description: shown.description,
        sourceTitle: title,
        ...(templateKey ? { templateKey } : {}),
    };
}

/** The three sources, in the order a person scans them. */
export function playbookCatalog(
    orgTasks: readonly PlaybookOrgTask[],
    scope: PlaybookScope = {},
): PlaybookSection[] {
    const checklist: PlaybookItem[] = onboardingChecklist(scope).map(item => {
        const shown = drawerWording(item.title, item.description);
        return {
            id: `onboarding:${item.templateKey}`,
            title: shown.title,
            description: shown.description,
            sourceTitle: item.title,
            templateKey: item.templateKey,
        };
    });
    const libraryGroups: PlaybookGroup[] = MARKETING_PLAN_STEPS.map(step => ({
        id: step.key,
        title: playbookGroupTitle(step.key, step.name),
        items: MARKETING_PLAN_TEMPLATE_ITEMS
            .filter(item => item.stepKey === step.key)
            .map((item, index) => libraryItem(step.key, index, item.title, item.description, item.templateKey)),
    })).filter(group => group.items.length > 0);

    const seenSaved = new Set<string>();
    const saved: PlaybookItem[] = [];
    for (const task of orgTasks) {
        const id = task.id.trim();
        const title = task.title.trim();
        if (!id || !title || seenSaved.has(id)) continue;
        seenSaved.add(id);
        saved.push({
            id: `saved:${id}`,
            title,
            description: task.description?.trim() ?? '',
        });
    }

    const sections: PlaybookSection[] = [
        {
            id: 'checklist',
            title: PLAYBOOK_COPY.checklist,
            groups: [{ id: 'start', title: PLAYBOOK_COPY.checklist, items: checklist }],
        },
        {
            id: 'library',
            title: PLAYBOOK_COPY.library,
            groups: libraryGroups,
        },
    ];
    if (saved.length > 0) {
        sections.push({
            id: 'saved',
            title: PLAYBOOK_COPY.saved,
            groups: [{ id: 'yours', title: PLAYBOOK_COPY.saved, items: saved }],
        });
    }
    return sections;
}

export function playbookItems(sections: readonly PlaybookSection[]): PlaybookItem[] {
    return sections.flatMap(section => section.groups.flatMap(group => group.items));
}

/** Every word must appear in the title or the description. */
export function playbookMatching(sections: readonly PlaybookSection[], query: string): PlaybookSection[] {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return sections.map(section => ({
        ...section,
        groups: section.groups.map(group => ({ ...group, items: [...group.items] })),
    }));
    return sections.flatMap(section => {
        const groups = section.groups.flatMap(group => {
            const items = group.items.filter(item => {
                const haystack = `${item.title} ${item.description}`.toLocaleLowerCase();
                return words.every(word => haystack.includes(word));
            });
            return items.length > 0 ? [{ ...group, items }] : [];
        });
        return groups.length > 0 ? [{ ...section, groups }] : [];
    });
}

export function playbookSameTitle(left: string, right: string): boolean {
    return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

/** Ignored, excluded, and off-roadmap checklist rows are not still on the plan. */
export function playbookLiveRows(existing: readonly PlaybookExisting[]): PlaybookExisting[] {
    return existing.filter(row => (
        row.status !== 'ignored'
        && row.excluded !== true
        && row.roadmapIncluded !== false
        && row.title.trim().length > 0
    ));
}

/** Shown wording plus the stored catalog title, when the drawer renamed it. */
export function playbookTitleAliases(item: Pick<PlaybookItem, 'title' | 'sourceTitle'>): string[] {
    const aliases = [item.title, item.sourceTitle ?? ''];
    const unique: string[] = [];
    for (const alias of aliases) {
        const title = alias.trim();
        if (!title || unique.some(chosen => playbookSameTitle(chosen, title))) continue;
        unique.push(title);
    }
    return unique;
}

/**
 * A checklist row the plan already stores.
 * A row left off the roadmap is excluded, same as an ignored or excluded row.
 */
export function checklistPlanRow(item: {
    title: string;
    status?: string | null;
    templateKey?: string | null;
    roadmapIncluded?: boolean;
}): PlaybookExisting | null {
    const title = item.title.trim();
    if (!title) return null;
    return {
        title,
        status: item.status,
        ...(item.templateKey ? { templateKey: item.templateKey } : {}),
        ...(item.roadmapIncluded === false ? { roadmapIncluded: false } : {}),
    };
}

/**
 * True when this saved task is already represented on the plan.
 * The shown wording and the stored catalog title both count, in any letter case.
 * A shared checklist key also matches.
 */
export function playbookOnPlan(item: Pick<PlaybookItem, 'title' | 'templateKey' | 'sourceTitle'>, existing: readonly PlaybookExisting[]): boolean {
    const aliases = playbookTitleAliases(item);
    if (aliases.length === 0) return false;
    const live = playbookLiveRows(existing);
    if (live.some(row => aliases.some(alias => playbookSameTitle(row.title, alias)))) return true;
    return aliases.some(alias => catalogAddBlocked(
        live.map(row => ({ title: row.title, templateKey: row.templateKey })),
        { title: alias, templateKey: item.templateKey },
    ));
}

export function playbookRowState(
    item: PlaybookItem,
    existing: readonly PlaybookExisting[],
    selected: readonly PlaybookItem[],
): PlaybookRowState {
    if (playbookOnPlan(item, existing)) return 'plan';
    if (selected.some(row => row.id === item.id)) return 'chosen';
    if (selected.some(row => playbookSameTitle(row.title, item.title))) return 'same';
    return 'open';
}

/**
 * Titles to create, in catalog order.
 * Rows already on the plan are left out. A repeated title in the same
 * selection is left out. Distinct titles that share a checklist key are both
 * kept, so choosing the whole saved list does not drop a task from that list.
 */
export function playbookAddTitles(items: readonly PlaybookItem[], existing: readonly PlaybookExisting[]): string[] {
    const titles: string[] = [];
    for (const item of items) {
        const title = item.title.trim();
        if (!title || title.length > STAGE_ADD_MAX_TITLE_LENGTH) continue;
        if (playbookOnPlan(item, existing)) continue;
        if (titles.some(chosen => playbookSameTitle(chosen, title))) continue;
        titles.push(title);
    }
    return titles;
}

export function playbookChoices(board: PlanBoard, month: string, today: string): PlaybookChoice[] {
    if (board === 'phases') {
        return PLAN_PHASES.map(id => ({
            id,
            label: PHASE_STAGE_COPY[id].title,
            detail: PHASE_STAGE_COPY[id].description,
            stage: id,
            dueDate: null,
        }));
    }
    const current = month === monthKeyFromDay(today);
    const label = current ? 'This month' : planMonthTitle(month);
    return [
        {
            id: 'onboarding',
            label: 'Onboarding',
            detail: PLAYBOOK_COPY.onboardingDetail,
            stage: 'onboarding',
            dueDate: null,
        },
        {
            id: 'this_month',
            label,
            detail: playbookMonthDetail(month, today),
            stage: 'backlog',
            dueDate: endOfMonthDay(month),
        },
        {
            id: 'backlog',
            label: 'Backlog',
            detail: PLAYBOOK_COPY.backlogDetail,
            stage: 'backlog',
            dueDate: null,
        },
    ];
}

/** The stage the drawer was opened from, or the first stage on that board. */
export function playbookChoiceId(board: PlanBoard, openedFrom: string | null): string {
    if (board === 'phases') {
        if (openedFrom === 'growth' || openedFrom === 'scale') return openedFrom;
        return 'foundation';
    }
    if (openedFrom === 'onboarding' || openedFrom === 'backlog') return openedFrom;
    return 'this_month';
}

export function playbookChoice(board: PlanBoard, month: string, today: string, id: string): PlaybookChoice | null {
    return playbookChoices(board, month, today).find(choice => choice.id === id) ?? null;
}

/** One create call per batch the existing add path will accept. */
export function playbookAddCalls(titles: readonly string[], choice: PlaybookChoice): PlaybookAddCall[] {
    const calls: PlaybookAddCall[] = [];
    for (let index = 0; index < titles.length; index += STAGE_ADD_MAX_TITLES) {
        const chunk = titles.slice(index, index + STAGE_ADD_MAX_TITLES);
        calls.push(choice.dueDate
            ? {
                stage: choice.stage,
                titles: chunk,
                dueDate: choice.dueDate,
                items: chunk.map(title => ({ title, depth: 0 })),
            }
            : { stage: choice.stage, titles: chunk });
    }
    return calls;
}

import { nextStagePositions } from '../seo-plan/stage-add.ts';

/**
 * Where an imported Basecamp to-do lands in the stage list.
 *
 * The client's configured onboarding list is one todolist (often titled
 * "Set up SEO campaign"), not the whole Onboarding Checklist to-do set.
 * A sibling list in that set stays in Backlog. A group or other recording
 * that sits inside the configured list counts as that list: the import
 * modal stamps the todolist id, and a caller that stamps the group id
 * still lands in Onboarding.
 *
 * Stage is written only on rows this import is about to insert. A to-do
 * that already exists keeps the stage a person moved it to.
 */

export interface OnboardingListScope {
    /** Configured onboarding todolist. Empty when the client has not chosen one. */
    onboardingTodolistId: string;
    /** Group and nested-list ids that belong to that list. */
    containedIds: readonly string[];
}

export const EMPTY_ONBOARDING_SCOPE: OnboardingListScope = {
    onboardingTodolistId: '',
    containedIds: [],
};

export function recordingId(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).trim();
    return /^\d+$/.test(normalized) ? normalized : null;
}

/** Ids of groups returned for one todolist. Anything that is not a recording is dropped. */
export function containedIdsFromBasecampGroups(payload: unknown): string[] {
    if (!Array.isArray(payload)) return [];
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const item of payload) {
        if (!item || typeof item !== 'object') continue;
        const id = recordingId((item as { id?: unknown }).id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
    }
    return ids;
}

export function sourceListIsOnboarding(
    sourceId: string | null,
    scope: OnboardingListScope,
): boolean {
    if (!sourceId || !scope.onboardingTodolistId) return false;
    if (sourceId === scope.onboardingTodolistId) return true;
    return scope.containedIds.includes(sourceId);
}

/**
 * Parent recording on a to-do payload.
 * A step's parent is the to-do itself, which is not a list, so it is ignored.
 * A missing parent leaves the decision to the list id the import asked for.
 */
export function providerParentListId(todo: {
    parent?: { id?: unknown; type?: unknown } | null;
}): string | null {
    const parent = todo.parent;
    if (!parent || typeof parent !== 'object') return null;
    const type = typeof parent.type === 'string' ? parent.type : '';
    if (type === 'Todo' || type === 'Kanban::Step') return null;
    return recordingId(parent.id);
}

/**
 * True when this to-do was imported from the configured onboarding list.
 * The list id on the request and the provider's parent recording both count,
 * so a group id still matches when the modal only sent the parent list, and
 * a parent list still matches when the provider reports the group.
 */
export function importedTodoLandsInOnboarding(input: {
    requestedListId: string | null;
    providerParentId: string | null;
    scope: OnboardingListScope;
}): boolean {
    if (sourceListIsOnboarding(input.requestedListId, input.scope)) return true;
    return sourceListIsOnboarding(input.providerParentId, input.scope);
}

/**
 * Positions for rows that are about to be inserted into Onboarding.
 * Other rows are returned unchanged so they keep the backlog default.
 * Positions append after tasks already in Onboarding. An empty column
 * starts at 1, which sorts after the database default of 0.
 */
export function assignOnboardingPositions(
    rows: readonly Record<string, unknown>[],
    maxPosition: number | null,
): Record<string, unknown>[] {
    const landing = rows.filter(row => row.stage === 'onboarding');
    const positions = nextStagePositions(maxPosition, landing.length);
    const positionByRow = new Map<Record<string, unknown>, number>();
    landing.forEach((row, index) => positionByRow.set(row, positions[index]));
    return rows.map(row => {
        const position = positionByRow.get(row);
        if (position === undefined) return row;
        return { ...row, position };
    });
}

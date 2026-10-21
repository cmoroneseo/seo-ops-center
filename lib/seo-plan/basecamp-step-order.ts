/**
 * Basecamp checklist order for SEO Plan subtasks.
 *
 * The plan shows children by tasks.position, then created_at, then id.
 * Creating a Kanban::Step does not place it at that position, so after the
 * steps exist we move only the ones that are out of place.
 *
 * The move is PUT /subtasks/{id}/position.json (basecampSubtaskPositionPath).
 */

export interface AppSubtaskOrder {
    id: string;
    position?: number | null;
    createdAt?: string | null;
}

function finitePosition(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Same ordering as the SEO Plan stage list: position, then created_at, then id. */
export function compareAppSubtaskOrder(a: AppSubtaskOrder, b: AppSubtaskOrder): number {
    const aPosition = finitePosition(a.position);
    const bPosition = finitePosition(b.position);
    if (aPosition != null && bPosition != null && aPosition !== bPosition) return aPosition - bPosition;
    if ((aPosition != null) !== (bPosition != null)) return aPosition != null ? -1 : 1;
    const aCreated = a.createdAt ?? '';
    const bCreated = b.createdAt ?? '';
    if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
}

export function sortByAppOrder<T extends AppSubtaskOrder>(items: readonly T[]): T[] {
    return [...items].sort(compareAppSubtaskOrder);
}

export interface StepOrderMove {
    stepId: string;
    /** 1-based position among the parent to-do's steps. */
    position: number;
}

function uniqueIds(ids: readonly string[]): string[] {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const id of ids) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        list.push(id);
    }
    return list;
}

/**
 * Moves that make Basecamp's steps follow `desiredStepIds`.
 * `currentStepIds` is the checklist in Basecamp's position order.
 * Nothing is returned when the plan's steps already appear in that order,
 * including when unrelated steps sit between them. When the order differs,
 * the plan's steps are placed at positions 1..n, and only steps that are
 * not already sitting there are returned.
 */
export function basecampStepOrderMoves(
    currentStepIds: readonly string[],
    desiredStepIds: readonly string[],
): StepOrderMove[] {
    const desired = uniqueIds(desiredStepIds);
    if (desired.length === 0) return [];
    const wanted = new Set(desired);
    const owned: string[] = [];
    const seenOwned = new Set<string>();
    for (const id of currentStepIds) {
        if (!wanted.has(id) || seenOwned.has(id)) continue;
        seenOwned.add(id);
        owned.push(id);
    }
    if (owned.length === desired.length && owned.every((id, index) => id === desired[index])) {
        return [];
    }

    const working = uniqueIds(currentStepIds);
    for (const id of desired) {
        if (!working.includes(id)) working.push(id);
    }
    const moves: StepOrderMove[] = [];
    for (let index = 0; index < desired.length; index += 1) {
        const stepId = desired[index];
        if (!stepId) continue;
        const from = working.indexOf(stepId);
        if (from === index) continue;
        if (from >= 0) working.splice(from, 1);
        working.splice(index, 0, stepId);
        moves.push({ stepId, position: index + 1 });
    }
    return moves;
}

/** Step ids for children that already have a Basecamp recording, in plan order. */
export function linkedStepIds<T extends AppSubtaskOrder & { basecampTodoId?: string | null }>(
    children: readonly T[],
): string[] {
    return sortByAppOrder(children).flatMap(child => child.basecampTodoId ? [child.basecampTodoId] : []);
}

export type StepOrderResult =
    | { ok: true; moves: StepOrderMove[] }
    | { ok: false; status: number; message: string; scope: 'client' | 'task' };

/**
 * Read the checklist and apply `basecampStepOrderMoves`.
 * An empty desired list does not read Basecamp. A matching order does not
 * reposition. The first failed move stops the pass so a retry can recompute.
 */
export async function alignBasecampStepOrder(input: {
    projectId: string;
    parentTodoId: string;
    desiredStepIds: readonly string[];
    listSteps: () => Promise<
        | { ok: true; steps: readonly { id: string }[] }
        | { ok: false; status: number; message: string; scope: 'client' | 'task' }
    >;
    repositionStep: (move: StepOrderMove) => Promise<
        | { ok: true }
        | { ok: false; status: number; message: string; scope: 'client' | 'task' }
    >;
}): Promise<StepOrderResult> {
    const desired = uniqueIds(input.desiredStepIds);
    if (desired.length === 0) return { ok: true, moves: [] };
    const listed = await input.listSteps();
    if (!listed.ok) return listed;
    const moves = basecampStepOrderMoves(listed.steps.map(step => step.id), desired);
    for (const move of moves) {
        const result = await input.repositionStep(move);
        if (!result.ok) return result;
    }
    return { ok: true, moves };
}

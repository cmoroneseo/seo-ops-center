/**
 * Presentation-only correlation for the client activity feed.
 *
 * Time logging and task completion stay separate audit records so each can
 * succeed, fail, and be inspected on its own. When one Stop confirmation
 * produced both, the server stamps them with a shared operation ID and this
 * module renders them as a single feed item without merging the underlying
 * rows and without ever adding a client's hours twice.
 */

export type ActivityCorrelationKind = 'time_log' | 'task_completed' | 'other';

export type ActivityBasecampStatus = 'synced' | 'failed' | 'syncing';

export interface ActivityCorrelationInput<T> {
    /** The caller's own feed item, returned untouched for rendering. */
    item: T;
    kind: ActivityCorrelationKind;
    id: string;
    occurredAt: string;
    /** Server-generated correlation ID; absent for everything else. */
    operationId?: string;
    taskId?: string;
    clientId?: string;
    actorId?: string;
    hours?: number;
    basecampStatus?: ActivityBasecampStatus;
}

export type ActivityPresentationKind = 'time' | 'completion' | 'time_and_completion' | 'other';

export interface ActivityPresentationItem<T> {
    kind: ActivityPresentationKind;
    /** Stable render key derived from the underlying audit rows. */
    id: string;
    occurredAt: string;
    hours?: number;
    basecampStatus?: ActivityBasecampStatus;
    /** Both audit row IDs survive grouping for drill-down. */
    sourceIds: string[];
    timeLog?: T;
    event?: T;
}

function presentationKind(kind: ActivityCorrelationKind): ActivityPresentationKind {
    if (kind === 'time_log') return 'time';
    return kind === 'task_completed' ? 'completion' : 'other';
}

function ungrouped<T>(input: ActivityCorrelationInput<T>): ActivityPresentationItem<T> {
    const kind = presentationKind(input.kind);
    return {
        kind,
        id: `${input.kind}-${input.id}`,
        occurredAt: input.occurredAt,
        ...(input.hours === undefined ? {} : { hours: input.hours }),
        ...(input.basecampStatus ? { basecampStatus: input.basecampStatus } : {}),
        sourceIds: [input.id],
        ...(kind === 'time' ? { timeLog: input.item } : { event: input.item }),
    };
}

/** Correlation demands every identity field, never timestamp proximity. */
function correlationKey<T>(input: ActivityCorrelationInput<T>): string | null {
    if (!input.operationId || !input.taskId || !input.clientId || !input.actorId) return null;
    return [input.operationId, input.taskId, input.clientId, input.actorId].join(' ');
}

export function groupClientActivity<T>(
    inputs: ActivityCorrelationInput<T>[],
): ActivityPresentationItem<T>[] {
    const completionsByKey = new Map<string, ActivityCorrelationInput<T>>();
    for (const input of inputs) {
        const key = input.kind === 'task_completed' ? correlationKey(input) : null;
        if (key && !completionsByKey.has(key)) completionsByKey.set(key, input);
    }

    // A cross-midnight operation finalizes several daily logs. Only its latest
    // one carries the completion so no daily total is dropped or duplicated.
    const groupedTimeLogByKey = new Map<string, ActivityCorrelationInput<T>>();
    for (const input of inputs) {
        const key = input.kind === 'time_log' ? correlationKey(input) : null;
        if (!key || !completionsByKey.has(key)) continue;
        const current = groupedTimeLogByKey.get(key);
        if (!current || input.occurredAt > current.occurredAt) {
            groupedTimeLogByKey.set(key, input);
        }
    }

    const consumedCompletionIds = new Set(
        [...groupedTimeLogByKey.keys()].map(key => completionsByKey.get(key)!.id),
    );

    const items: ActivityPresentationItem<T>[] = [];
    for (const input of inputs) {
        const key = correlationKey(input);
        if (input.kind === 'time_log' && key && groupedTimeLogByKey.get(key)?.id === input.id) {
            const completion = completionsByKey.get(key)!;
            items.push({
                kind: 'time_and_completion',
                id: `time_and_completion-${input.id}-${completion.id}`,
                occurredAt: input.occurredAt > completion.occurredAt ? input.occurredAt : completion.occurredAt,
                ...(input.hours === undefined ? {} : { hours: input.hours }),
                ...(input.basecampStatus ? { basecampStatus: input.basecampStatus } : {}),
                sourceIds: [input.id, completion.id],
                timeLog: input.item,
                event: completion.item,
            });
            continue;
        }
        if (input.kind === 'task_completed' && consumedCompletionIds.has(input.id)) continue;
        items.push(ungrouped(input));
    }

    return items.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

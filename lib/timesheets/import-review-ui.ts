import { budgetDefaultFor, findActivity } from './activities';
import type { QueueRow } from './import-queue-route';
import type { Suggestion } from './suggestions';

export interface ImportEntryEdit {
    activityKey: string;
    detail: string;
    clientId: string | null;
    countsTowardBudget: boolean;
}

export interface ImportDraft {
    activityKey: string | null;
    detail: string;
    clientId: string | null;
    countsTowardBudget: boolean;
}

export interface KeyedResult<T> {
    requestKey: string;
    items: T[];
}

export function currentRequestItems<T>(result: KeyedResult<T>, requestKey: string): T[] {
    return result.requestKey === requestKey ? result.items : [];
}

export function detailForRow(row: QueueRow): string {
    const activity = row.activityKey ? findActivity(row.activityKey) : null;
    if (!activity) return row.description;
    if (row.description === activity.label) return '';
    const prefix = `${activity.label} — `;
    return row.description.startsWith(prefix) ? row.description.slice(prefix.length) : row.description;
}

export function draftForRow(row: QueueRow): ImportDraft {
    return {
        activityKey: row.activityKey,
        detail: detailForRow(row),
        clientId: row.isInternal ? null : row.clientId,
        countsTowardBudget: row.isInternal ? false : row.countsTowardBudget,
    };
}

export function normalizeImportDraft(row: QueueRow, draft: ImportDraft): ImportDraft {
    return row.isInternal
        ? { ...draft, clientId: null, countsTowardBudget: false }
        : draft;
}

export function buildImportEdit(
    row: QueueRow,
    draft: ImportDraft,
    patch: Partial<ImportDraft> = {},
): ImportEntryEdit | null {
    const activityKey = patch.activityKey ?? draft.activityKey;
    if (!activityKey) return null;
    return {
        activityKey,
        detail: patch.detail ?? draft.detail,
        clientId: row.isInternal ? null : patch.clientId === undefined
            ? draft.clientId
            : patch.clientId,
        countsTowardBudget: row.isInternal ? false : patch.countsTowardBudget
            ?? draft.countsTowardBudget,
    };
}

export function buildActivityEdit(
    row: QueueRow,
    draft: ImportDraft,
    activityKey: string,
): ImportEntryEdit {
    return buildImportEdit(row, draft, {
        activityKey,
        countsTowardBudget: activityKey === draft.activityKey
            ? draft.countsTowardBudget
            : budgetDefaultFor(activityKey),
    })!;
}

export function buildSuggestionEdit(
    row: QueueRow,
    draft: ImportDraft,
    suggestion: Suggestion,
): ImportEntryEdit | null {
    const activityKey = suggestion.activityKey ?? draft.activityKey;
    if (!activityKey) return null;
    const changesActivity = Boolean(
        suggestion.activityKey && suggestion.activityKey !== draft.activityKey,
    );
    return buildImportEdit(row, draft, {
        activityKey,
        detail: suggestion.title,
        countsTowardBudget: changesActivity
            ? budgetDefaultFor(activityKey)
            : draft.countsTowardBudget,
    });
}

export function planBulkClientEdits(
    rows: QueueRow[],
    selected: Set<string>,
    clientId: string | null,
) {
    const byId = new Map(rows.map(row => [row.id, row]));
    const selectedRows = [...selected].flatMap(id => {
        const row = byId.get(id);
        return row ? [row] : [];
    });
    const externalRows = selectedRows.filter(row => !row.isInternal);
    const editableRows = externalRows.filter(
        (row): row is QueueRow & { activityKey: string } => Boolean(row.activityKey),
    );
    return {
        affectedCount: editableRows.length,
        excludedInternalCount: selectedRows.length - externalRows.length,
        invalidActivityCount: externalRows.length - editableRows.length,
        missingCount: selected.size - selectedRows.length,
        edits: editableRows.map(row => ({
            id: row.id,
            edit: buildImportEdit(row, draftForRow(row), { clientId })!,
        })),
    };
}

export function createInFlightRequestCache<T>() {
    const requests = new Map<string, Promise<T>>();
    return {
        get(key: string, load: () => Promise<T>) {
            const existing = requests.get(key);
            if (existing) return existing;
            let request: Promise<T>;
            try {
                request = Promise.resolve(load());
            } catch (error) {
                request = Promise.reject(error);
            }
            requests.set(key, request);
            const clear = () => {
                if (requests.get(key) === request) requests.delete(key);
            };
            void request.then(clear, clear);
            return request;
        },
    };
}

export async function settleOperations(operations: Array<() => Promise<unknown>>) {
    const results = await Promise.allSettled(
        operations.map(operation => Promise.resolve().then(operation)),
    );
    const errors = results.flatMap(result => result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason : new Error('Operation failed')]
        : []);
    return {
        succeededCount: results.length - errors.length,
        failedCount: errors.length,
        errors,
    };
}

export async function withRunningState<T>(
    setRunning: (running: boolean) => void,
    operation: () => Promise<T>,
): Promise<T> {
    setRunning(true);
    try {
        return await operation();
    } finally {
        setRunning(false);
    }
}

export function createLatestRequestSequencer<T>() {
    let latestRequest = 0;
    return {
        async run(load: () => Promise<T>, apply: (value: T) => void) {
            const request = ++latestRequest;
            try {
                const value = await load();
                if (request !== latestRequest) return false;
                apply(value);
                return true;
            } catch (error) {
                if (request !== latestRequest) return false;
                throw error;
            }
        },
        invalidate() { latestRequest += 1; },
    };
}

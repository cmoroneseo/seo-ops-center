import { budgetDefaultFor, describeActivity } from './activities';
import { MAX_TASK_TITLE_LENGTH } from './import-tasks-route';
import type { QueueRow } from './import-queue-route';
import type { Suggestion } from './suggestions';
import { MAX_REFERENCE_LINKS, validateReferenceLinks } from './reference-links';
import type { TimeLogReferenceLink } from '../types';

export interface ImportEntryEdit {
    activityKeys: string[];
    detail: string;
    clientId: string | null;
    countsTowardBudget: boolean;
    referenceLinks: TimeLogReferenceLink[];
    /**
     * Present only when this edit is about the task link. Retagging a block or
     * fixing its detail must never carry — or silently drop — an attribution
     * the person did not touch.
     */
    taskId?: string | null;
}

export interface ImportDraft {
    activityKeys: string[];
    detail: string;
    clientId: string | null;
    countsTowardBudget: boolean;
    /** Documents this block of time produced or cited. */
    referenceLinks: TimeLogReferenceLink[];
    /** The linked SEO PM task, and its title for display. Null when unlinked. */
    taskId: string | null;
    taskTitle: string | null;
    /**
     * True once `countsTowardBudget` represents a decision rather than a
     * suggestion.
     *
     * Budget eligibility is not derivable from the activity: reviewed data has
     * Account Management & Comms billable for two clients and non-billable for
     * two others, and Internal Admin billable three times and non-billable
     * once. So the activity set may only seed the budget flag on FIRST
     * selection — once a person has decided, changing the activities must
     * never silently recompute it.
     */
    budgetIsExplicit: boolean;
}

export interface KeyedResult<T> {
    requestKey: string;
    items: T[];
}

export function currentRequestItems<T>(result: KeyedResult<T>, requestKey: string): T[] {
    return result.requestKey === requestKey ? result.items : [];
}

export function detailForRow(row: QueueRow): string {
    // describeActivity writes "<labels> — <detail>", so peel the labels the
    // row's own activity set produces back off. Catalog order makes that a
    // stable string rather than a guess at how it was originally picked.
    const label = describeActivity(row.activityKeys, '');
    if (!label) return row.description;
    if (row.description === label) return '';
    const prefix = `${label} — `;
    return row.description.startsWith(prefix) ? row.description.slice(prefix.length) : row.description;
}

export function draftForRow(row: QueueRow): ImportDraft {
    return {
        activityKeys: row.activityKeys,
        referenceLinks: row.referenceLinks,
        taskId: row.taskId,
        taskTitle: row.taskTitle,
        detail: detailForRow(row),
        clientId: row.isInternal ? null : row.clientId,
        countsTowardBudget: row.isInternal ? false : row.countsTowardBudget,
        // A row that already carries activities has been through review, so
        // its stored flag is a decision that survives further edits.
        budgetIsExplicit: row.activityKeys.length > 0,
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
    const activityKeys = patch.activityKeys ?? draft.activityKeys;
    if (activityKeys.length === 0) return null;
    const clientId = row.isInternal ? null : patch.clientId === undefined
        ? draft.clientId
        : patch.clientId;
    // Moving a row to another client strands any task link it carries on the
    // client it came from, and billable time attributed to the wrong client's
    // work is exactly what the RPC's same-client guard exists to prevent. So a
    // client change clears the link rather than leaving it dangling.
    const strandsTaskLink = draft.taskId !== null && clientId !== draft.clientId;
    const taskId = patch.taskId !== undefined
        ? patch.taskId
        : strandsTaskLink ? null : undefined;
    return {
        activityKeys,
        referenceLinks: patch.referenceLinks ?? draft.referenceLinks,
        detail: patch.detail ?? draft.detail,
        clientId,
        countsTowardBudget: row.isInternal ? false : patch.countsTowardBudget
            ?? draft.countsTowardBudget,
        ...(taskId === undefined ? {} : { taskId }),
    };
}

/**
 * The draft patch linking this entry to a task produces.
 *
 * The title rides along so the row reads back the task it was just linked to
 * without waiting for the queue to reload — `taskTitle` on the source row is a
 * join, and the local draft is what the person is looking at.
 */
export function taskLinkPatch(
    taskId: string,
    taskTitle: string,
): Partial<ImportDraft> {
    return { taskId, taskTitle };
}

/** The draft patch unlinking this entry's task produces. */
export function taskUnlinkPatch(): Partial<ImportDraft> {
    return { taskId: null, taskTitle: null };
}

/**
 * The draft patch adding one link produces, or the reason it was refused.
 *
 * Validation lives here rather than in the component so the rejection a person
 * sees is the same rule the route enforces.
 */
export function addReferenceLinkPatch(
    draft: ImportDraft,
    label: string,
    url: string,
): { ok: true; patch: Partial<ImportDraft> } | { ok: false; error: string } {
    if (draft.referenceLinks.length >= MAX_REFERENCE_LINKS) {
        return {
            ok: false,
            error: `An entry can carry at most ${MAX_REFERENCE_LINKS} links`,
        };
    }

    const candidate = validateReferenceLinks([{ label, url }]);
    if (!candidate.ok) return { ok: false, error: candidate.error };

    const added = candidate.links[0];
    if (draft.referenceLinks.some(link => link.url === added.url)) {
        return { ok: false, error: 'That link is already on this entry' };
    }
    return { ok: true, patch: { referenceLinks: [...draft.referenceLinks, added] } };
}

/** The draft patch removing the link at `index` produces. */
export function removeReferenceLinkPatch(
    draft: ImportDraft,
    index: number,
): Partial<ImportDraft> {
    return {
        referenceLinks: draft.referenceLinks.filter((_, position) => position !== index),
    };
}

/**
 * The title "Create task from this entry" prefills.
 *
 * The person's own words first, then the activity tags, then whatever the
 * import carried — a reviewed August entry reads "Added roadmap To-do's to
 * basecamp", which is already a perfectly good task title.
 */
export function taskTitleFromDraft(row: QueueRow, draft: ImportDraft): string {
    const candidate = draft.detail.trim()
        || describeActivity(draft.activityKeys, '')
        || row.description.trim();
    return candidate.slice(0, MAX_TASK_TITLE_LENGTH);
}

/** The draft patch a budget toggle produces — always an explicit decision. */
export function budgetChoicePatch(countsTowardBudget: boolean): Partial<ImportDraft> {
    return { countsTowardBudget, budgetIsExplicit: true };
}

/**
 * The draft patch a change of activities produces.
 *
 * The budget default is offered only while no explicit choice exists. Once one
 * does, retagging the block leaves it exactly as the person set it.
 */
export function activityChoicePatch(
    draft: ImportDraft,
    activityKeys: string[],
): Partial<ImportDraft> {
    return {
        activityKeys,
        countsTowardBudget: draft.budgetIsExplicit
            ? draft.countsTowardBudget
            : budgetDefaultFor(activityKeys),
    };
}

export function buildActivityEdit(
    row: QueueRow,
    draft: ImportDraft,
    activityKeys: string[],
): ImportEntryEdit | null {
    return buildImportEdit(row, draft, activityChoicePatch(draft, activityKeys));
}

export function buildSuggestionEdit(
    row: QueueRow,
    draft: ImportDraft,
    suggestion: Suggestion,
): ImportEntryEdit | null {
    const activityKeys = suggestion.activityKeys.length > 0
        ? suggestion.activityKeys
        : draft.activityKeys;
    if (activityKeys.length === 0) return null;
    return buildImportEdit(row, draft, {
        ...activityChoicePatch(draft, activityKeys),
        detail: suggestion.title,
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
        row => row.activityKeys.length > 0,
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

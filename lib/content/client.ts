import type { ProductionStatus, TopicalMapRecord } from '../types';

export async function approveContentRecord(input: {
    clientId: string;
    recordId: string;
    workMonth: string;
}): Promise<{ record: TopicalMapRecord | null; taskId?: string; error?: string }> {
    return send('POST', input);
}

export async function updateContentRecord(input: {
    clientId: string;
    recordId: string;
    productionStatus?: ProductionStatus | null;
    workMonth?: string | null;
    dueDate?: string | null;
    publishedOn?: string | null;
    draftUrl?: string | null;
    liveUrl?: string | null;
}): Promise<{ record: TopicalMapRecord | null; error?: string }> {
    return send('PATCH', input);
}

/**
 * Decline goes through the same server route as every other content change,
 * so a viewer gets the same 403. "Not going ahead" sets the plan to declined.
 */
export async function declineContentRecord(input: {
    clientId: string;
    recordId: string;
}): Promise<{ record: TopicalMapRecord | null; error?: string }> {
    return send('PATCH', { ...input, productionStatus: 'declined' satisfies ProductionStatus });
}

/** Fix a page title. Same server route, so a viewer gets the same 403. */
export async function renameContentRecord(input: {
    clientId: string;
    recordId: string;
    title: string;
}): Promise<{ record: TopicalMapRecord | null; error?: string }> {
    return send('PATCH', input);
}

/**
 * Undo an approval or restore a declined idea. The page goes back to
 * "not written yet" and the plan back to waiting. A linked task is kept and
 * reused if the page is approved again.
 */
export async function reopenContentRecord(input: {
    clientId: string;
    recordId: string;
}): Promise<{ record: TopicalMapRecord | null; error?: string }> {
    return send('PATCH', { ...input, productionStatus: 'not_written' satisfies ProductionStatus });
}

export interface BulkResult {
    saved: TopicalMapRecord[];
    failed: Array<{ id: string; error: string }>;
}

/**
 * Run one content change per page, a few at a time. Each page goes through
 * the same server route as a single change, so approval still reuses a
 * linked task and a viewer still gets a 403 on every page.
 */
export async function runBulk(
    ids: ReadonlyArray<string>,
    run: (id: string) => Promise<{ record: TopicalMapRecord | null; error?: string }>,
    concurrency = 4,
): Promise<BulkResult> {
    const unique = [...new Set(ids)];
    const results: Array<{ id: string; record: TopicalMapRecord | null; error?: string }> = new Array(unique.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, unique.length)) }, async () => {
        while (cursor < unique.length) {
            const index = cursor;
            cursor += 1;
            const id = unique[index];
            try {
                const result = await run(id);
                results[index] = { id, ...result };
            } catch {
                results[index] = { id, record: null, error: 'Could not save this page.' };
            }
        }
    });
    await Promise.all(workers);
    const saved: TopicalMapRecord[] = [];
    const failed: BulkResult['failed'] = [];
    for (const result of results) {
        if (!result) continue;
        if (result.record) saved.push(result.record);
        else failed.push({ id: result.id, error: result.error ?? 'Could not save this page.' });
    }
    return { saved, failed };
}

/** One plain sentence for a bulk run that did not fully land. */
export function bulkFailureMessage(result: BulkResult, verb: 'approve' | 'decline'): string | null {
    if (result.failed.length === 0) return null;
    const errors = [...new Set(result.failed.map(item => item.error))];
    const reason = errors.length === 1 ? ` ${errors[0]}` : '';
    if (result.saved.length === 0) {
        return result.failed.length === 1
            ? `Could not ${verb} this idea.${reason}`
            : `Could not ${verb} the ${result.failed.length} selected ideas.${reason}`;
    }
    return `${result.saved.length} saved, ${result.failed.length} could not be ${verb === 'approve' ? 'approved' : 'declined'}.${reason}`;
}

async function send(
    method: 'POST' | 'PATCH',
    body: unknown,
): Promise<{ record: TopicalMapRecord | null; taskId?: string; error?: string }> {
    try {
        const response = await fetch('/api/content/records', {
            method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => ({})) as { record?: TopicalMapRecord; taskId?: string; error?: unknown };
        if (!response.ok || !payload.record) {
            return { record: null, error: typeof payload.error === 'string' ? payload.error : 'Could not save this page.' };
        }
        return { record: payload.record, taskId: payload.taskId };
    } catch {
        return { record: null, error: 'Could not save this page.' };
    }
}

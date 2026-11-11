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

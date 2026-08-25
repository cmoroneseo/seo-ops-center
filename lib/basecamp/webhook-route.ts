const COMPLETION_KINDS = new Set([
    'todo_completion_created',
    'todo_completed',
    'todo_changed',
]);

const REOPEN_KINDS = new Set([
    'todo_completion_destroyed',
    'todo_uncompleted',
]);

const BASECAMP_WEBHOOK_USER_AGENT = 'Basecamp3 Webhook';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BasecampWebhookTask {
    id: string;
    status: string;
    statusHistory: unknown[];
    organizationId: string;
    clientId: string | null;
    title: string;
    basecampTodoId: string;
    basecampProjectId: string;
}

interface DeliveryReceipt {
    eventId: string;
    requestId: string;
    kind: string;
    recordingId: string;
}

interface WebhookStore {
    claimDelivery(delivery: DeliveryReceipt): Promise<'new' | 'retry' | 'processed'>;
    markDeliveryProcessed(eventId: string, result: string): Promise<void>;
    getTaskByTodoId(todoId: string): Promise<BasecampWebhookTask | null>;
    updateTaskStatus(
        task: BasecampWebhookTask,
        status: 'done' | 'todo',
        actorName: string,
        now: string,
    ): Promise<boolean>;
}

interface Dependencies {
    expectedAccountId: string;
    now(): string;
    store: WebhookStore;
    provider: {
        isConfigured(): boolean;
        getTodo(
            projectId: string,
            todoId: string,
        ): Promise<{ id: string | number; completed: boolean } | null>;
    };
    logCompletion(task: BasecampWebhookTask, actorName: string): Promise<void>;
}

interface ParsedPayload {
    eventId: string;
    kind: string;
    recordingId: string;
    recordingUrl: string;
    actorName: string;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

function numericId(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).trim();
    return /^\d+$/.test(normalized) ? normalized : null;
}

function parsePayload(value: unknown): ParsedPayload | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const payload = value as Record<string, unknown>;
    const recording = payload.recording;
    if (!recording || typeof recording !== 'object' || Array.isArray(recording)) return null;
    const recordingObject = recording as Record<string, unknown>;
    const eventId = numericId(payload.id);
    const recordingId = numericId(recordingObject.id);
    const kind = typeof payload.kind === 'string' ? payload.kind.trim() : '';
    const recordingUrl = typeof recordingObject.url === 'string' ? recordingObject.url : '';
    if (!eventId || !recordingId || !kind || !recordingUrl) return null;

    const creator = payload.creator;
    const actorName = creator && typeof creator === 'object' && !Array.isArray(creator)
        && typeof (creator as Record<string, unknown>).name === 'string'
        ? String((creator as Record<string, unknown>).name)
        : 'Basecamp';

    return { eventId, kind, recordingId, recordingUrl, actorName };
}

function hasCanonicalRecordingUrl(
    recordingUrl: string,
    accountId: string,
    projectId: string,
    todoId: string,
) {
    try {
        const url = new URL(recordingUrl);
        if (url.protocol !== 'https:' || url.hostname !== '3.basecampapi.com') return false;
        return url.pathname === `/${accountId}/buckets/${projectId}/todos/${todoId}.json`;
    } catch {
        return false;
    }
}

export function createBasecampWebhookPost(dependencies: Dependencies) {
    return async function postBasecampWebhook(req: Request): Promise<Response> {
        const requestId = req.headers.get('x-request-id')?.trim() ?? '';
        if (
            req.headers.get('user-agent') !== BASECAMP_WEBHOOK_USER_AGENT
            || !UUID_PATTERN.test(requestId)
        ) {
            return json({ error: 'Invalid Basecamp delivery envelope' }, 401);
        }

        let payloadValue: unknown;
        try {
            payloadValue = await req.json();
        } catch {
            return json({ error: 'Invalid JSON' }, 400);
        }
        const payload = parsePayload(payloadValue);
        if (!payload) return json({ error: 'Invalid Basecamp webhook payload' }, 400);

        try {
            const claim = await dependencies.store.claimDelivery({
                eventId: payload.eventId,
                requestId,
                kind: payload.kind,
                recordingId: payload.recordingId,
            });
            if (claim === 'processed') {
                return json({ ok: true, skipped: 'duplicate' });
            }

            const isRelevant = COMPLETION_KINDS.has(payload.kind) || REOPEN_KINDS.has(payload.kind);
            if (!isRelevant) {
                await dependencies.store.markDeliveryProcessed(payload.eventId, `skipped:${payload.kind}`);
                return json({ ok: true, skipped: payload.kind });
            }

            const task = await dependencies.store.getTaskByTodoId(payload.recordingId);
            if (!task) {
                await dependencies.store.markDeliveryProcessed(payload.eventId, 'skipped:no-linked-task');
                return json({ ok: true, skipped: 'no linked task' });
            }

            if (!dependencies.expectedAccountId || !dependencies.provider.isConfigured()) {
                return json({ error: 'Basecamp provider verification unavailable' }, 503);
            }
            if (
                task.basecampTodoId !== payload.recordingId
                || !hasCanonicalRecordingUrl(
                    payload.recordingUrl,
                    dependencies.expectedAccountId,
                    task.basecampProjectId,
                    task.basecampTodoId,
                )
            ) {
                return json({ error: 'Basecamp delivery provenance mismatch' }, 403);
            }

            const providerTodo = await dependencies.provider.getTodo(
                task.basecampProjectId,
                task.basecampTodoId,
            );
            if (!providerTodo || String(providerTodo.id) !== task.basecampTodoId) {
                return json({ error: 'Basecamp provider verification unavailable' }, 503);
            }

            const desiredStatus = providerTodo.completed ? 'done' : 'todo';
            const action = providerTodo.completed ? 'completed' : 'reopened';
            const changed = task.status !== desiredStatus
                ? await dependencies.store.updateTaskStatus(
                    task,
                    desiredStatus,
                    payload.actorName,
                    dependencies.now(),
                )
                : false;

            if (changed && desiredStatus === 'done') {
                await dependencies.logCompletion(task, payload.actorName);
            }
            await dependencies.store.markDeliveryProcessed(
                payload.eventId,
                changed ? action : 'no-status-change',
            );

            return changed
                ? json({ ok: true, action, taskId: task.id })
                : json({ ok: true, skipped: 'no status change needed' });
        } catch {
            return json({ error: 'Basecamp webhook processing failed' }, 500);
        }
    };
}

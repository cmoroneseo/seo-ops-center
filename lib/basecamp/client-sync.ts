export interface ClientBasecampSyncResult {
    success: boolean;
    providerId?: string;
    error?: string;
    /** The destination declined the entry. `error` is the reason, when it sent one. */
    skipped?: boolean;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function requestSync(
    url: string,
    body: Record<string, unknown>,
    fetcher: FetchLike,
    providerIdKey: string,
): Promise<ClientBasecampSyncResult> {
    try {
        const response = await fetcher(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => null) as {
            success?: boolean;
            skipped?: boolean;
            error?: string;
            reason?: string;
            [key: string]: unknown;
        } | null;
        if (response.ok && payload?.skipped === true) {
            const reason = typeof payload.reason === 'string' && payload.reason.trim()
                ? payload.reason
                : undefined;
            return { success: false, skipped: true, ...(reason ? { error: reason } : {}) };
        }
        if (!response.ok || payload?.success !== true) {
            return {
                success: false,
                error: payload?.error || `Basecamp sync failed (${response.status})`,
            };
        }
        const providerId = payload[providerIdKey];
        return {
            success: true,
            ...((typeof providerId === 'string' || typeof providerId === 'number')
                ? { providerId: String(providerId) }
                : {}),
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Basecamp sync failed',
        };
    }
}

export function requestTaskBasecampSync(
    taskId: string,
    fetcher: FetchLike = fetch,
): Promise<ClientBasecampSyncResult> {
    return requestSync(
        '/api/integrations/basecamp/push',
        { action: 'create_todo', taskId },
        fetcher,
        'todoId',
    );
}

export function requestTimeLogBasecampSync(
    timeLogId: string,
    fetcher: FetchLike = fetch,
): Promise<ClientBasecampSyncResult> {
    return requestSync(
        '/api/integrations/basecamp/timesheet',
        { action: 'sync', timeLogId, createIfMissing: true },
        fetcher,
        'entryId',
    );
}

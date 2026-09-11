export class SyncRequestError extends Error {
    constructor(message: string, public status: number) { super(message); }
}

type Authorization = { ok: true; organizationId: string; clientId: string } | { ok: false; status: number; error: string };

/** Cron may run globally; a dashboard request must name an authorized client. */
export async function authorizeSyncRequest(req: Request, secret: string | undefined, authorize: (clientId: string) => Promise<Authorization>, now = new Date()) {
    const machine = !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
    if (req.method === 'GET' && !machine) throw new SyncRequestError('Unauthorized', 401);
    let body: Record<string, unknown> = {};
    if (req.method !== 'GET') {
        const text = await req.text();
        if (text) {
            try { body = JSON.parse(text); } catch { throw new SyncRequestError('Invalid JSON', 400); }
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SyncRequestError('Invalid request', 400);
        }
    }
    const clientId = body.clientId;
    if (clientId !== undefined && (typeof clientId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId))) throw new SyncRequestError('Invalid clientId', 400);
    const month = body.month ?? now.toISOString().slice(0, 7);
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > now.toISOString().slice(0, 7)) throw new SyncRequestError('Invalid or future month', 400);
    if (machine) return { clientId: clientId as string | undefined, month, organizationId: undefined };
    if (!clientId) throw new SyncRequestError('A client is required for manual sync', 400);
    const auth = await authorize(clientId as string);
    if (!auth.ok) throw new SyncRequestError(auth.error, auth.status);
    return { clientId: auth.clientId, organizationId: auth.organizationId, month };
}

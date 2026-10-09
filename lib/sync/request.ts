import { cronMonths, ptMonth } from './months';

export class SyncRequestError extends Error {
    constructor(message: string, public status: number) { super(message); }
}

type Authorization = { ok: true; organizationId: string; clientId: string } | { ok: false; status: number; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface SyncScope {
    clientId: string | undefined;
    month: string;
    months: string[];
    organizationId: string | undefined;
    trigger: 'cron' | 'manual';
}

/** Cron may run globally; a dashboard request must name an authorized client. Months are Pacific. */
export async function authorizeSyncRequest(
    req: Request,
    secret: string | undefined,
    authorize: (clientId: string) => Promise<Authorization>,
    now = new Date(),
): Promise<SyncScope> {
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
    if (clientId !== undefined && (typeof clientId !== 'string' || !UUID.test(clientId))) {
        throw new SyncRequestError('Invalid clientId', 400);
    }
    const current = ptMonth(now);
    const requested = body.month;
    let month: string;
    let months: string[];
    if (requested === undefined) {
        months = machine ? cronMonths(now) : [current];
        month = months[0];
    } else if (typeof requested !== 'string' || !MONTH.test(requested) || requested > current) {
        throw new SyncRequestError('Invalid or future month', 400);
    } else {
        month = requested;
        months = [requested];
    }
    const trigger = machine ? 'cron' : 'manual';
    if (machine) return { clientId: clientId as string | undefined, month, months, organizationId: undefined, trigger };
    if (!clientId) throw new SyncRequestError('A client is required for manual sync', 400);
    const auth = await authorize(clientId as string);
    if (!auth.ok) throw new SyncRequestError(auth.error, auth.status);
    return { clientId: auth.clientId, organizationId: auth.organizationId, month, months, trigger };
}

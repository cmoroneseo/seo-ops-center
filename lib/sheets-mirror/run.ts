import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { buildMirror, type MirrorTab } from './model';
import type { MirrorStore, Trigger } from './store';

export const MIRROR_OFF = 'Sheet mirror is off';
export const MISSING_CREDENTIALS = 'Google service account credentials are missing or invalid';

export function mirrorEnabled(env: { SHEETS_MIRROR_ENABLED?: string }): boolean {
    return env.SHEETS_MIRROR_ENABLED === 'true';
}

interface SyncDeps {
    enabled: boolean;
    store: Pick<MirrorStore, 'loadClient' | 'loadData' | 'reserve' | 'finish'>;
    write: (sheetId: string, tabs: MirrorTab[]) => Promise<void>;
    now: () => Date;
    basecampAccountId?: string;
    trigger: Trigger;
    organizationId?: string;
    requestedBy?: string;
    runId?: string;
}

export async function syncClientSheet(clientId: string, deps: SyncDeps) {
    if (!deps.enabled) return { status: 'skipped', reason: 'disabled' } as const;
    const client = await deps.store.loadClient(clientId, deps.organizationId);
    if (!client?.roadmap_sheet_id) return { status: 'skipped', reason: 'missing_sheet' } as const;
    const runId = deps.runId ?? randomUUID();
    const reservation = await deps.store.reserve(runId, client, deps.trigger, deps.requestedBy ?? null);
    if (reservation !== 'reserved') return { status: 'skipped', reason: reservation } as const;

    let rowsWritten: Record<string, number> = {};
    let error: string | null = null;
    try {
        const data = await deps.store.loadData(client);
        const { tabs } = buildMirror({ ...data, now: deps.now(), basecampAccountId: deps.basecampAccountId });
        await deps.write(client.roadmap_sheet_id, tabs);
        rowsWritten = Object.fromEntries(tabs.map(tab => [tab.title, tab.rows.length - 1]));
    } catch (err) {
        error = (err instanceof Error ? err.message : 'Sheet sync failed').slice(0, 1000);
    }
    const status = error === null ? 'succeeded' as const : 'failed' as const;
    await deps.store.finish(runId, {
        status, rows_written: rowsWritten, error, finished_at: deps.now().toISOString(),
    });
    return { status, rowsWritten, error };
}

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export interface MirrorMessage {
    chainId: string;
    index: number;
    clients: string[];
}

export function parseMirrorMessage(value: unknown): MirrorMessage | null {
    if (!value || typeof value !== 'object') return null;
    const { chainId, index, clients } = value as Partial<MirrorMessage>;
    if (typeof chainId !== 'string' || !uuid.test(chainId)
        || typeof index !== 'number' || !Number.isSafeInteger(index)
        || !Array.isArray(clients) || index < 0 || index >= clients.length
        || !clients.every(id => typeof id === 'string' && uuid.test(id))) return null;
    return { chainId, index, clients };
}

function queueSignature(message: MirrorMessage, secret: string): Buffer {
    return createHmac('sha256', secret)
        .update(JSON.stringify(['client-sheet-mirror', message.chainId, message.index, message.clients]))
        .digest();
}

export function signMirrorMessage(message: MirrorMessage, secret: string) {
    return { ...message, signature: queueSignature(message, secret).toString('hex') };
}

export function verifyMirrorMessage(payload: unknown, secret: string | undefined): MirrorMessage | null {
    const message = parseMirrorMessage(payload);
    if (!message || !secret) return null;
    const { signature } = payload as { signature?: unknown };
    if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/.test(signature)) return null;
    return timingSafeEqual(Buffer.from(signature, 'hex'), queueSignature(message, secret)) ? message : null;
}

interface ChainDeps {
    enabled: boolean;
    publish(message: MirrorMessage): Promise<void>;
}

export async function runMirrorCron(deps: ChainDeps & { listClients(): Promise<string[]> }) {
    if (!deps.enabled) return { skipped: true, reason: MIRROR_OFF };
    const clients = await deps.listClients();
    if (clients.length) await deps.publish({ chainId: randomUUID(), index: 0, clients });
    return { enqueued: clients.length ? 1 : 0, clients: clients.length };
}

export async function runMirrorQueue(payload: unknown, deps: ChainDeps & {
    sync(clientId: string, runId: string): Promise<unknown>;
}) {
    if (!deps.enabled) return;
    const message = parseMirrorMessage(payload);
    if (!message) return;
    const { chainId, index, clients } = message;
    // A redelivery can advance the chain without snapshotting a finished run twice.
    const hex = createHash('sha256').update(`${chainId}:${index}`).digest('hex');
    const runId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    try {
        await deps.sync(clients[index], runId);
    } catch {
        console.error('Client sheet mirror sync failed');
    }
    if (index + 1 < clients.length) await deps.publish({ ...message, index: index + 1 });
}

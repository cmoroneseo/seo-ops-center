import type { ForecastPayload } from './contract.ts';

export type ForecastRunStatus = 'succeeded' | 'undone';

export interface ForecastSyncRunRecord {
    id: string;
    organizationId: string;
    createdBy: string;
    createdByName: string;
    createdAt: string;
    weekStarts: string[];
    payloadHash: string;
    payload: ForecastPayload;
    status: ForecastRunStatus;
    externalId: string | null;
    undoneAt: string | null;
    undoneBy: string | null;
}

export type ForecastUndoMark = 'updated' | 'already_undone' | 'missing';

export interface ForecastRunStore {
    /** Succeeded runs, newest first. */
    listSucceeded(organizationId: string): Promise<ForecastSyncRunRecord[]>;
    findSucceededByHash(organizationId: string, payloadHash: string): Promise<ForecastSyncRunRecord | null>;
    insertSucceeded(run: ForecastSyncRunRecord): Promise<
        | { ok: true; run: ForecastSyncRunRecord }
        | { ok: false; conflict: true }
    >;
    markUndone(
        organizationId: string,
        runId: string,
        undoneBy: string,
        undoneAt: string,
    ): Promise<ForecastUndoMark>;
}

/** The sync table is not in the database yet. The UI shows an em dash, not a zero. */
export class ForecastStoreUnavailable extends Error {
    constructor() {
        super('Forecast sync storage is not set up.');
        this.name = 'ForecastStoreUnavailable';
    }
}

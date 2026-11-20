import type { createAdminClient } from '../supabase/admin';
import type { RoadmapRow, TaskRow } from './model';

export const CLIENT_COLUMNS = 'id,organization_id,roadmap_sheet_id,sheet_mirror_enabled';
export const ROADMAP_COLUMNS = 'id,title,step_key,status,priority,due_date,roadmap_phase,roadmap_included,sort_order,task_id,updated_at';
export const TASK_COLUMNS = 'id,title,parent_task_id,category,stage,status,start_date,due_date,completed_at,published_url,basecamp_project_id,basecamp_todo_id';
export const LOG_COLUMNS = 'started_at,finished_at,status,trigger,rows_written,error';

export interface MirrorClient {
    id: string;
    organization_id: string;
    roadmap_sheet_id: string | null;
    sheet_mirror_enabled: boolean;
}

export type Trigger = 'cron' | 'manual';
export type Reservation = 'reserved' | 'duplicate' | 'missing_sheet' | 'rate_limited' | 'busy';
export interface SyncLog {
    started_at: string;
    finished_at: string | null;
    status: 'running' | 'succeeded' | 'failed' | 'skipped';
    trigger: Trigger;
    rows_written: Record<string, number>;
    error: string | null;
}

interface Page<T> {
    data: T[] | null;
    error: unknown;
}

async function allRows<T>(page: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
    const rows: T[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await page(offset, offset + pageSize - 1);
        if (error || !data) throw new Error('Could not load sheet mirror data');
        rows.push(...data);
        if (data.length < pageSize) return rows;
    }
}

export function createMirrorStore(db: ReturnType<typeof createAdminClient>) {
    return {
        async loadClient(clientId: string, organizationId?: string): Promise<MirrorClient | null> {
            let query = db.from('clients').select(CLIENT_COLUMNS).eq('id', clientId);
            if (organizationId) query = query.eq('organization_id', organizationId);
            const { data, error } = await query.maybeSingle();
            if (error) throw new Error('Could not load the client sheet');
            return data;
        },
        async listClients(): Promise<string[]> {
            const rows = await allRows<{ id: string }>((from, to) => db.from('clients').select('id')
                .eq('sheet_mirror_enabled', true).not('roadmap_sheet_id', 'is', null).in('status', ['active', 'onboarding'])
                .order('id').range(from, to));
            return rows.map(row => row.id);
        },
        async loadData(client: MirrorClient) {
            const forClient = (table: string, columns: string) => db.from(table).select(columns)
                .eq('organization_id', client.organization_id).eq('client_id', client.id);
            const [roadmap, tasks] = await Promise.all([
                allRows<RoadmapRow>((from, to) => forClient('marketing_plan_items', ROADMAP_COLUMNS)
                    .eq('roadmap_included', true).order('id').range(from, to).returns<RoadmapRow[]>()),
                allRows<TaskRow>((from, to) => forClient('tasks', TASK_COLUMNS)
                    .order('id').range(from, to).returns<TaskRow[]>()),
            ]);
            return { roadmap, tasks };
        },
        async reserve(runId: string, client: MirrorClient, trigger: Trigger, requestedBy: string | null): Promise<Reservation> {
            const { data, error } = await db.rpc('reserve_sheet_sync_run', {
                p_run_id: runId,
                p_client_id: client.id,
                p_org_id: client.organization_id,
                p_sheet_id: client.roadmap_sheet_id,
                p_trigger: trigger,
                p_requested_by: requestedBy,
            });
            if (error) throw new Error('Could not reserve a sheet sync');
            return data;
        },
        async finish(runId: string, log: Pick<SyncLog, 'status' | 'rows_written' | 'error' | 'finished_at'>) {
            const { error } = await db.from('sheet_sync_runs').update(log).eq('id', runId).eq('status', 'running');
            if (error) throw new Error('Could not save the sheet sync result');
        },
        async listRuns(clientId: string, organizationId: string): Promise<SyncLog[]> {
            const { data, error } = await db.from('sheet_sync_runs').select(LOG_COLUMNS)
                .eq('client_id', clientId).eq('organization_id', organizationId)
                .order('started_at', { ascending: false }).order('id', { ascending: false }).limit(10);
            if (error) throw new Error('Could not load recent sheet syncs');
            return data;
        },
    };
}

export type MirrorStore = ReturnType<typeof createMirrorStore>;

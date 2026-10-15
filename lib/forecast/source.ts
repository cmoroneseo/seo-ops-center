import { createAdminClient } from '@/lib/supabase/admin';
import type { ForecastEvent, ForecastLog, ForecastMember, ForecastTask } from './build.ts';
import { parseForecastPayload, type ForecastPayload } from './contract.ts';
import {
    ForecastStoreUnavailable,
    type ForecastRunStore,
    type ForecastSyncRunRecord,
    type ForecastUndoMark,
} from './store.ts';

interface MemberRow {
    user_id: string;
    users: { full_name?: string | null; email?: string | null } | { full_name?: string | null; email?: string | null }[] | null;
}

interface LogRow {
    id: string;
    user_id: string | null;
    client_id: string | null;
    date: string;
    hours: number | string | null;
    status: string | null;
    import_status: string | null;
    voided_at: string | null;
    planner_event_id: string | null;
    clients: { name?: string | null } | { name?: string | null }[] | null;
}

interface EventRow {
    id: string;
    user_id: string;
    attendee_ids: string[] | null;
    kind: string;
    starts_at: string;
    ends_at: string;
    all_day: boolean | null;
    client_id: string | null;
    title: string | null;
    clients: { name?: string | null } | { name?: string | null }[] | null;
}

interface TaskRow {
    id: string;
    title: string | null;
    status: string | null;
    assignee_ids: string[] | null;
    client_id: string | null;
    start_date: string | null;
    estimated_hours: number | string | null;
    clients: { name?: string | null } | { name?: string | null }[] | null;
}

interface RunRow {
    id: string;
    organization_id: string;
    created_by: string;
    created_at: string;
    week_starts: string[];
    payload_hash: string;
    payload: unknown;
    status: string;
    external_id: string | null;
    undone_at: string | null;
    undone_by: string | null;
}

function one<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}

function readHours(value: number | string | null | undefined): number | null {
    if (value == null || value === '') return null;
    const hours = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(hours) ? hours : null;
}

export function rowToForecastMember(row: MemberRow): ForecastMember {
    const user = one(row.users);
    const email = user?.email?.trim() ?? '';
    return {
        userId: row.user_id,
        displayName: user?.full_name?.trim() || (email.includes('@') ? email.split('@')[0] : 'Member'),
        email,
    };
}

export function rowToForecastLog(row: LogRow): ForecastLog {
    const client = one(row.clients);
    return {
        id: row.id,
        userId: row.user_id ?? '',
        clientId: row.client_id ?? undefined,
        clientName: client?.name?.trim() || undefined,
        date: row.date,
        hours: readHours(row.hours),
        status: row.status ?? 'logged',
        importStatus: row.import_status ?? 'mapped',
        voidedAt: row.voided_at ?? undefined,
        plannerEventId: row.planner_event_id ?? undefined,
    };
}

export function rowToForecastEvent(row: EventRow): ForecastEvent {
    const client = one(row.clients);
    return {
        id: row.id,
        userId: row.user_id,
        attendeeIds: row.attendee_ids ?? [],
        kind: row.kind,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        allDay: row.all_day === true,
        clientId: row.client_id ?? undefined,
        clientName: client?.name?.trim() || undefined,
        title: row.title?.trim() || 'Meeting',
    };
}

export function rowToForecastTask(row: TaskRow): ForecastTask {
    const client = one(row.clients);
    const estimate = readHours(row.estimated_hours);
    const present = row.estimated_hours != null && row.estimated_hours !== '';
    return {
        id: row.id,
        title: row.title?.trim() || 'Untitled task',
        status: row.status ?? 'todo',
        assigneeIds: row.assignee_ids ?? [],
        clientId: row.client_id ?? undefined,
        clientName: client?.name?.trim() || undefined,
        startDate: row.start_date ?? undefined,
        estimatedHours: present && estimate != null ? estimate : null,
        estimateUnreadable: present && estimate == null,
    };
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
    if (!error) return false;
    return error.code === '42P01'
        || error.code === 'PGRST205'
        || /campaign_desk_sync_runs/i.test(error.message ?? '');
}

export async function loadForecastSource(scope: {
    organizationId: string;
    from: string;
    to: string;
}): Promise<{ members: ForecastMember[]; logs: ForecastLog[]; events: ForecastEvent[]; tasks: ForecastTask[] }> {
    const admin = createAdminClient();
    const [memberResult, logResult, eventResult, taskResult] = await Promise.all([
        admin.from('organization_members').select('user_id, users(full_name, email)').eq('organization_id', scope.organizationId),
        admin.from('time_logs')
            .select('id, user_id, client_id, date, hours, status, import_status, voided_at, planner_event_id, clients(name)')
            .eq('organization_id', scope.organizationId)
            .gte('date', scope.from)
            .lt('date', scope.to),
        admin.from('planner_events')
            .select('id, user_id, attendee_ids, kind, starts_at, ends_at, all_day, client_id, title, clients(name)')
            .eq('organization_id', scope.organizationId)
            .lt('starts_at', `${scope.to}T00:00:00.000Z`)
            .gt('ends_at', `${scope.from}T00:00:00.000Z`),
        admin.from('tasks')
            .select('id, title, status, assignee_ids, client_id, start_date, estimated_hours, clients(name)')
            .eq('organization_id', scope.organizationId)
            .gte('start_date', `${scope.from}T00:00:00.000Z`)
            .lt('start_date', `${scope.to}T00:00:00.000Z`),
    ]);
    if (memberResult.error) throw memberResult.error;
    if (logResult.error) throw logResult.error;
    if (eventResult.error) throw eventResult.error;
    if (taskResult.error) throw taskResult.error;

    const logs = ((logResult.data ?? []) as unknown as LogRow[]).map(rowToForecastLog);
    const events = ((eventResult.data ?? []) as unknown as EventRow[]).map(rowToForecastEvent);
    const have = new Set(events.map(event => event.id));
    const missing = [...new Set(logs.flatMap(log => log.plannerEventId ? [log.plannerEventId] : []))]
        .filter(id => !have.has(id));
    if (missing.length > 0) {
        const extra = await admin.from('planner_events')
            .select('id, user_id, attendee_ids, kind, starts_at, ends_at, all_day, client_id, title, clients(name)')
            .eq('organization_id', scope.organizationId)
            .in('id', missing);
        if (extra.error) throw extra.error;
        events.push(...((extra.data ?? []) as unknown as EventRow[]).map(rowToForecastEvent));
    }

    return {
        members: ((memberResult.data ?? []) as unknown as MemberRow[]).map(rowToForecastMember),
        logs,
        events,
        tasks: ((taskResult.data ?? []) as unknown as TaskRow[]).map(rowToForecastTask),
    };
}

function rowToRun(row: RunRow, names: Map<string, string>): ForecastSyncRunRecord | null {
    let payload: ForecastPayload;
    try {
        payload = parseForecastPayload(row.payload);
    } catch {
        return null;
    }
    return {
        id: row.id,
        organizationId: row.organization_id,
        createdBy: row.created_by,
        createdByName: names.get(row.created_by) || 'A teammate',
        createdAt: row.created_at,
        weekStarts: (row.week_starts ?? []).map(week => String(week).slice(0, 10)),
        payloadHash: row.payload_hash,
        payload,
        status: row.status === 'undone' ? 'undone' : 'succeeded',
        externalId: row.external_id,
        undoneAt: row.undone_at,
        undoneBy: row.undone_by,
    };
}

async function namesFor(userIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    const { data, error } = await createAdminClient()
        .from('users')
        .select('id, full_name, email')
        .in('id', unique);
    if (error) throw error;
    const names = new Map<string, string>();
    for (const row of data ?? []) {
        const name = (row.full_name as string | null)?.trim();
        const email = (row.email as string | null)?.trim();
        names.set(row.id as string, name || (email?.includes('@') ? email.split('@')[0] : 'A teammate'));
    }
    return names;
}

export function createForecastRunStore(): ForecastRunStore {
    return {
        async listSucceeded(organizationId) {
            const { data, error } = await createAdminClient()
                .from('campaign_desk_sync_runs')
                .select('id, organization_id, created_by, created_at, week_starts, payload_hash, payload, status, external_id, undone_at, undone_by')
                .eq('organization_id', organizationId)
                .eq('status', 'succeeded')
                .order('created_at', { ascending: false });
            if (isMissingTable(error)) throw new ForecastStoreUnavailable();
            if (error) throw error;
            const rows = (data ?? []) as unknown as RunRow[];
            const names = await namesFor(rows.map(row => row.created_by));
            return rows.flatMap(row => {
                const run = rowToRun(row, names);
                return run ? [run] : [];
            });
        },
        async findSucceededByHash(organizationId, payloadHash) {
            const { data, error } = await createAdminClient()
                .from('campaign_desk_sync_runs')
                .select('id, organization_id, created_by, created_at, week_starts, payload_hash, payload, status, external_id, undone_at, undone_by')
                .eq('organization_id', organizationId)
                .eq('payload_hash', payloadHash)
                .eq('status', 'succeeded')
                .maybeSingle();
            if (isMissingTable(error)) throw new ForecastStoreUnavailable();
            if (error) throw error;
            if (!data) return null;
            const row = data as unknown as RunRow;
            const names = await namesFor([row.created_by]);
            return rowToRun(row, names);
        },
        async insertSucceeded(run) {
            const { error } = await createAdminClient().from('campaign_desk_sync_runs').insert({
                id: run.id,
                organization_id: run.organizationId,
                created_by: run.createdBy,
                created_at: run.createdAt,
                week_starts: run.weekStarts,
                payload_hash: run.payloadHash,
                payload: run.payload,
                status: 'succeeded',
                external_id: run.externalId,
            });
            if (isMissingTable(error)) throw new ForecastStoreUnavailable();
            if (error?.code === '23505') return { ok: false, conflict: true };
            if (error) throw error;
            return { ok: true, run };
        },
        async markUndone(organizationId, runId, undoneBy, undoneAt): Promise<ForecastUndoMark> {
            const admin = createAdminClient();
            const existing = await admin
                .from('campaign_desk_sync_runs')
                .select('id, status')
                .eq('organization_id', organizationId)
                .eq('id', runId)
                .maybeSingle();
            if (isMissingTable(existing.error)) throw new ForecastStoreUnavailable();
            if (existing.error) throw existing.error;
            if (!existing.data) return 'missing';
            if (existing.data.status === 'undone') return 'already_undone';
            const updated = await admin
                .from('campaign_desk_sync_runs')
                .update({ status: 'undone', undone_at: undoneAt, undone_by: undoneBy })
                .eq('organization_id', organizationId)
                .eq('id', runId)
                .eq('status', 'succeeded')
                .select('id')
                .maybeSingle();
            if (isMissingTable(updated.error)) throw new ForecastStoreUnavailable();
            if (updated.error) throw updated.error;
            return updated.data ? 'updated' : 'already_undone';
        },
    };
}

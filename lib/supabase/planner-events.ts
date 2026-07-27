import { createClient } from './client';
import { PlannerEvent, PlannerEventKind, PlannerEventVisibility } from '../types';

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToPlannerEvent(row: any): PlannerEvent {
    return {
        id: row.id,
        organizationId: row.organization_id,
        userId: row.user_id,
        title: row.title,
        description: row.description ?? undefined,
        kind: row.kind as PlannerEventKind,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        allDay: row.all_day,
        location: row.location ?? undefined,
        clientId: row.client_id ?? undefined,
        taskId: row.task_id ?? undefined,
        attendeeIds: row.attendee_ids ?? [],
        busy: row.busy,
        visibility: row.visibility as PlannerEventVisibility,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export interface PlannerEventInsert {
    organizationId: string;
    userId: string;
    title: string;
    description?: string;
    kind: PlannerEventKind;
    startsAt: string;
    endsAt: string;
    allDay?: boolean;
    location?: string;
    clientId?: string;
    taskId?: string;
    attendeeIds?: string[];
    busy?: boolean;
    visibility?: PlannerEventVisibility;
}

export interface PlannerEventPatch {
    title?: string;
    description?: string | null;
    kind?: PlannerEventKind;
    startsAt?: string;
    endsAt?: string;
    allDay?: boolean;
    location?: string | null;
    clientId?: string | null;
    taskId?: string | null;
    attendeeIds?: string[];
    busy?: boolean;
    visibility?: PlannerEventVisibility;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Every event overlapping [rangeStart, rangeEnd). An event that starts before
 * the window but ends inside it still belongs on the grid, hence the
 * starts_at < rangeEnd AND ends_at > rangeStart pair rather than a BETWEEN.
 */
export async function listPlannerEvents(params: {
    organizationId: string;
    rangeStart: string;
    rangeEnd: string;
}): Promise<PlannerEvent[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('planner_events')
            .select('*')
            .eq('organization_id', params.organizationId)
            .lt('starts_at', params.rangeEnd)
            .gt('ends_at', params.rangeStart)
            .order('starts_at', { ascending: true });
        if (error) throw error;
        return (data ?? []).map(rowToPlannerEvent);
    } catch (err) {
        console.error('[planner-events] list error:', err);
        return [];
    }
}

export async function createPlannerEvent(params: PlannerEventInsert): Promise<PlannerEvent | null> {
    const supabase = createClient();
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('planner_events')
            .insert([{
                organization_id: params.organizationId,
                user_id: params.userId,
                title: params.title,
                description: params.description ?? null,
                kind: params.kind,
                starts_at: params.startsAt,
                ends_at: params.endsAt,
                all_day: params.allDay ?? false,
                location: params.location ?? null,
                client_id: params.clientId ?? null,
                task_id: params.taskId ?? null,
                attendee_ids: params.attendeeIds ?? [],
                busy: params.busy ?? true,
                visibility: params.visibility ?? 'default',
            }])
            .select('*')
            .single();
        if (error) throw error;
        return rowToPlannerEvent(data);
    } catch (err) {
        console.error('[planner-events] create error:', err);
        return null;
    }
}

export async function updatePlannerEvent(
    id: string,
    patch: PlannerEventPatch,
): Promise<PlannerEvent | null> {
    const supabase = createClient();
    if (!supabase) return null;
    try {
        const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (patch.title !== undefined) row.title = patch.title;
        if (patch.description !== undefined) row.description = patch.description;
        if (patch.kind !== undefined) row.kind = patch.kind;
        if (patch.startsAt !== undefined) row.starts_at = patch.startsAt;
        if (patch.endsAt !== undefined) row.ends_at = patch.endsAt;
        if (patch.allDay !== undefined) row.all_day = patch.allDay;
        if (patch.location !== undefined) row.location = patch.location;
        if (patch.clientId !== undefined) row.client_id = patch.clientId;
        if (patch.taskId !== undefined) row.task_id = patch.taskId;
        if (patch.attendeeIds !== undefined) row.attendee_ids = patch.attendeeIds;
        if (patch.busy !== undefined) row.busy = patch.busy;
        if (patch.visibility !== undefined) row.visibility = patch.visibility;

        const { data, error } = await supabase
            .from('planner_events')
            .update(row)
            .eq('id', id)
            .select('*')
            .single();
        if (error) throw error;
        return rowToPlannerEvent(data);
    } catch (err) {
        console.error('[planner-events] update error:', err);
        return null;
    }
}

export async function deletePlannerEvent(id: string): Promise<boolean> {
    const supabase = createClient();
    if (!supabase) return false;
    try {
        const { error } = await supabase.from('planner_events').delete().eq('id', id);
        if (error) throw error;
        return true;
    } catch (err) {
        console.error('[planner-events] delete error:', err);
        return false;
    }
}

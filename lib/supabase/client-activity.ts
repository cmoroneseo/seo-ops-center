import { createAdminClient } from './admin';
import { createClient } from './client';
import { ClientActivityEvent } from '../types';

function rowToEvent(row: any): ClientActivityEvent {
    return {
        id: row.id,
        organizationId: row.organization_id,
        clientId: row.client_id,
        eventType: row.event_type,
        actorId: row.actor_id ?? undefined,
        actorName: row.actor_name ?? undefined,
        metadata: row.metadata ?? {},
        occurredAt: row.occurred_at,
    };
}

/** Write an activity event (server-side only — uses service role). */
export async function logClientActivity(payload: {
    organizationId: string;
    clientId: string;
    eventType: string;
    actorId?: string;
    actorName?: string;
    metadata?: Record<string, unknown>;
}): Promise<void> {
    const admin = createAdminClient();
    if (!admin) return;
    const { error } = await admin.from('client_activity_log').insert({
        organization_id: payload.organizationId,
        client_id: payload.clientId,
        event_type: payload.eventType,
        actor_id: payload.actorId ?? null,
        actor_name: payload.actorName ?? null,
        metadata: payload.metadata ?? {},
    });
    if (error) console.error('logClientActivity error:', error);
}

/** Fetch activity events for a client (browser-safe). */
export async function getClientActivity(clientId: string): Promise<ClientActivityEvent[]> {
    const supabase = createClient();
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('client_activity_log')
        .select('*')
        .eq('client_id', clientId)
        .order('occurred_at', { ascending: false })
        .limit(100);
    if (error) {
        console.error('getClientActivity error:', error);
        return [];
    }
    return (data ?? []).map(rowToEvent);
}

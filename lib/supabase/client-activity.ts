import { createAdminClient } from './admin';
import { createClient } from './client';
import { ClientActivityEvent, ActivityEventType } from '../types';

/**
 * Set of event types the authenticated /api/activity endpoint will accept from
 * the browser. Server-only writers (integration routes, retainer amend) call
 * logClientActivity directly and are not constrained by this list.
 */
export const ALLOWED_ACTIVITY_EVENT_TYPES: ReadonlySet<ActivityEventType> = new Set([
    'task.created',
    'task.completed',
    'task.assigned',
    'task.status_changed',
    'deliverable.created',
    'deliverable.status_changed',
    'deliverable.published',
    'client.created',
    'client.status_changed',
    'client.tier_changed',
    'campaign.created',
    'campaign.submitted_for_review',
    'campaign.approved',
    'campaign.phase_status_changed',
    'campaign.expectation_flagged',
    'campaign.kpi_rebaselined',
]);

/**
 * Browser-safe activity logger. POSTs to /api/activity, which derives the actor
 * and organization from the authenticated session (never trusts the client for
 * those) and verifies the user can access the target client via RLS.
 * Fire-and-forget — failures are logged, never thrown, so they can't break UX.
 */
export function logActivity(payload: {
    clientId: string;
    eventType: ActivityEventType;
    metadata?: Record<string, unknown>;
}): void {
    fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).catch((err) => console.error('logActivity error:', err));
}

function rowToEvent(row: any): ClientActivityEvent {
    return {
        id: row.id,
        organizationId: row.organization_id,
        clientId: row.client_id,
        eventType: row.event_type,
        actorId: row.actor_id ?? undefined,
        actorName: row.actor_name ?? undefined,
        operationId: row.operation_id ?? undefined,
        metadata: row.metadata ?? {},
        occurredAt: row.occurred_at,
    };
}

/**
 * Event types that describe OUR tooling rather than the client's work.
 *
 * The activity feed doubles as a client-facing report, and "tasks imported
 * from Basecamp" answers a question no client asked — where a task came from —
 * while a backfilled import stamps it at the top of their feed. The rows are
 * still written and still queryable; they are simply not part of the story the
 * client is shown.
 */
const INTERNAL_EVENT_TYPES: ReadonlySet<string> = new Set([
    'integration.tasks_imported',
]);

/** Whether an event belongs in the client-facing feed and its export. */
export function isClientVisibleEvent(eventType: string): boolean {
    return !INTERNAL_EVENT_TYPES.has(eventType);
}

/** Write an activity event (server-side only — uses service role). */
export async function logClientActivity(payload: {
    organizationId: string;
    clientId: string;
    eventType: string;
    actorId?: string;
    actorName?: string;
    /**
     * Server-generated correlation ID. Only trusted server paths (Stop
     * finalization) supply one; the browser /api/activity route never
     * forwards a caller-supplied value.
     */
    operationId?: string;
    /**
     * When the event actually happened, if that is not now.
     *
     * Needed because work can enter SEO PM long after it was done: a Basecamp
     * to-do completed on the 17th and imported on the 27th belongs in the
     * client's feed on the 17th, beside its peers. Without this the column
     * defaults to now() and every backfilled event stacks at the top of the
     * feed on the day of the import, which reads to the client as work done
     * today.
     */
    occurredAt?: string | null;
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
        operation_id: payload.operationId ?? null,
        // Omitted rather than nulled: the column's default is now(), and an
        // explicit null would violate NOT NULL instead of falling back.
        ...(payload.occurredAt ? { occurred_at: payload.occurredAt } : {}),
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
    return (data ?? []).map(rowToEvent).filter((event: ClientActivityEvent) => isClientVisibleEvent(event.eventType));
}

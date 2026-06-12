import { createClient } from './client';

// ============================================================
// Types
// ============================================================

export type NotificationType =
  | 'task_assigned'
  | 'task_mentioned'
  | 'note_mentioned'
  | 'deliverable_assigned'
  | 'deliverable_overdue'
  | 'deliverable_at_risk'
  | 'deliverable_status';
export type EntityType = 'task' | 'task_comment' | 'client_note' | 'deliverable';

export interface AppNotification {
  id: string;
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  entityType?: EntityType;
  entityId?: string;
  clientId?: string;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationInsert {
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  entityType?: EntityType;
  entityId?: string;
  clientId?: string;
}

// ============================================================
// Row → domain mapper
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToNotification(row: Record<string, any>): AppNotification {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body ?? undefined,
    entityType: row.entity_type ?? undefined,
    entityId: row.entity_id ?? undefined,
    clientId: row.client_id ?? undefined,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

// ============================================================
// CRUD functions
// ============================================================

/**
 * Create a notification. Fire-and-forget — never throws.
 */
export async function createNotification(n: NotificationInsert): Promise<void> {
  const supabase = createClient();
  if (!supabase) return;
  const { error } = await supabase.from('notifications').insert({
    organization_id: n.organizationId,
    user_id: n.userId,
    type: n.type,
    title: n.title,
    body: n.body ?? null,
    entity_type: n.entityType ?? null,
    entity_id: n.entityId ?? null,
    client_id: n.clientId ?? null,
  });
  if (error) {
    console.error('[notifications] createNotification error:', error.message);
  }
}

/**
 * Fetch the most recent notifications for a user.
 */
export async function getNotifications(
  userId: string,
  limit = 30,
): Promise<AppNotification[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[notifications] getNotifications error:', error.message);
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: Record<string, any>) => rowToNotification(r));
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationRead(notificationId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) return;
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId);
  if (error) {
    console.error('[notifications] markNotificationRead error:', error.message);
  }
}

/**
 * Mark all unread notifications as read for a user+org.
 */
export async function markAllNotificationsRead(
  userId: string,
  organizationId: string,
): Promise<void> {
  const supabase = createClient();
  if (!supabase) return;
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .eq('is_read', false);
  if (error) {
    console.error('[notifications] markAllNotificationsRead error:', error.message);
  }
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  AppNotification,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/lib/supabase/notifications';

export function useNotifications(
  userId: string | undefined,
  organizationId: string | undefined,
) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Initial fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getNotifications(userId).then((data) => {
      setNotifications(data);
      setLoading(false);
    });
  }, [userId]);

  // ── Realtime subscription ──────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = payload.new as Record<string, any>;
          const notification: AppNotification = {
            id: row.id,
            organizationId: row.organization_id,
            userId: row.user_id,
            type: row.type,
            title: row.title,
            body: row.body ?? undefined,
            entityType: row.entity_type ?? undefined,
            entityId: row.entity_id ?? undefined,
            clientId: row.client_id ?? undefined,
            isRead: row.is_read,
            createdAt: row.created_at,
          };
          setNotifications((prev) => [notification, ...prev]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const markRead = useCallback(async (notificationId: string) => {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n)),
    );
    await markNotificationRead(notificationId);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!userId || !organizationId) return;
    // Optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await markAllNotificationsRead(userId, organizationId);
  }, [userId, organizationId]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return { notifications, unreadCount, markRead, markAllRead, loading };
}

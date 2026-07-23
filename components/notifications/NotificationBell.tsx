'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Briefcase, CheckSquare, MessageSquare, AlarmClock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import type { AppNotification, NotificationType } from '@/lib/supabase/notifications';

// ── Icon by notification type ───────────────────────────────────────────────
function NotificationIcon({ type }: { type: NotificationType }) {
  if (type === 'task_assigned') return <CheckSquare className="h-4 w-4 text-primary" />;
  if (type === 'task_mentioned') return <CheckSquare className="h-4 w-4 text-blue-400" />;
  if (type === 'reminder_due') return <AlarmClock className="h-4 w-4 text-primary" />;
  return <MessageSquare className="h-4 w-4 text-amber-400" />;
}

// ── Navigation URL helper ───────────────────────────────────────────────────
function buildUrl(n: AppNotification): string {
  if (n.clientId && (n.type === 'task_assigned' || n.type === 'task_mentioned')) {
    return `/workspace/${n.clientId}?tab=tasks`;
  }
  if (n.clientId && n.type === 'note_mentioned') {
    return `/workspace/${n.clientId}`;
  }
  if (n.type === 'task_assigned' || n.type === 'task_mentioned') {
    return '/tasks';
  }
  return '/dashboard';
}

// ── Single notification row ─────────────────────────────────────────────────
function NotificationRow({
  notification,
  onRead,
}: {
  notification: AppNotification;
  onRead: (id: string) => void;
}) {
  const router = useRouter();

  const handleClick = () => {
    if (!notification.isRead) onRead(notification.id);
    if (notification.type === 'reminder_due') {
      if (notification.clientId) {
        router.push(`/workspace/${notification.clientId}`);
      } else {
        window.dispatchEvent(new CustomEvent('reminders:open'));
      }
      return;
    }
    router.push(buildUrl(notification));
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        'w-full text-left px-4 py-3 flex gap-3 items-start hover:bg-accent/20 transition-colors',
        !notification.isRead && 'bg-primary/5',
      )}
    >
      <div className="mt-0.5 flex-shrink-0">
        <NotificationIcon type={notification.type} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm leading-tight', !notification.isRead ? 'font-medium text-foreground' : 'text-muted-foreground')}>
          {notification.title}
        </p>
        {notification.body && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{notification.body}</p>
        )}
        <p className="text-[10px] text-muted-foreground/60 mt-1">
          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
        </p>
      </div>
      {!notification.isRead && (
        <span className="flex-shrink-0 mt-1.5 h-2 w-2 rounded-full bg-primary" />
      )}
    </button>
  );
}

// ── Main bell component ─────────────────────────────────────────────────────
export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { organization } = useOrganization();
  const { userId } = useCurrentMember();

  const { notifications, unreadCount, markRead, markAllRead, loading } = useNotifications(
    userId || undefined,
    organization?.id,
  );

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Group into Today / Earlier
  const today = new Date().toDateString();
  const todayNotifs = notifications.filter(
    (n) => new Date(n.createdAt).toDateString() === today,
  );
  const earlierNotifs = notifications.filter(
    (n) => new Date(n.createdAt).toDateString() !== today,
  );

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'relative h-12 w-12 flex items-center justify-center rounded-xl transition-colors',
          isOpen
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground',
        )}
        title="Notifications"
      >
        <Bell className="h-6 w-6" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown — opens below the top-bar bell */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute right-0 top-full mt-2 z-[200] w-80 max-h-[480px] flex flex-col rounded-xl border border-border bg-card shadow-xl shadow-black/10"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Notifications</span>
              {unreadCount > 0 && (
                <span className="text-xs bg-primary/10 text-primary font-medium px-1.5 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead()}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {/* Feed */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : notifications.length === 0 ? (
              <div className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
                <Bell className="h-8 w-8 opacity-30" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              <>
                {todayNotifs.length > 0 && (
                  <>
                    <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 bg-muted/20">
                      Today
                    </div>
                    {todayNotifs.map((n) => (
                      <NotificationRow key={n.id} notification={n} onRead={markRead} />
                    ))}
                  </>
                )}
                {earlierNotifs.length > 0 && (
                  <>
                    <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 bg-muted/20">
                      Earlier
                    </div>
                    {earlierNotifs.map((n) => (
                      <NotificationRow key={n.id} notification={n} onRead={markRead} />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

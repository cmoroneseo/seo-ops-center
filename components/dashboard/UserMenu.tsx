'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown, Settings, Clock, CheckSquare,
  MessageSquarePlus, HelpCircle, LogOut, NotebookPen, AlarmClock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { useOrganization } from '@/components/providers/organization-provider';
import { countOverdueReminders } from '@/lib/supabase/personal-reminders';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || '?';
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

export function UserMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { displayName, email, role, isLoading, userId } = useCurrentMember();
  const { organization } = useOrganization();
  const [overdueCount, setOverdueCount] = useState(0);

  useEffect(() => {
    if (!organization || !userId) return;
    const load = () => countOverdueReminders({ organizationId: organization.id, userId }).then(setOverdueCount);
    load();
    window.addEventListener('reminders:changed', load);
    return () => window.removeEventListener('reminders:changed', load);
  }, [organization, userId]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  async function signOut() {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    if (supabase) {
      await supabase.auth.signOut();
      window.location.href = '/';
    }
  }

  function fireEvent(name: string) {
    setIsOpen(false);
    window.dispatchEvent(new CustomEvent(name));
  }

  const itemClass =
    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent/20 transition-colors';

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'relative flex items-center gap-1 rounded-xl p-1.5 transition-colors',
          isOpen ? 'bg-primary/10' : 'hover:bg-accent/20',
        )}
        title="Account"
      >
        {isLoading ? (
          <span className="h-8 w-8 rounded-full bg-muted animate-pulse" />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
            {initialsOf(displayName)}
          </span>
        )}
        {overdueCount > 0 && (
          <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-red-500" />
        )}
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full mt-2 z-[200] w-64 rounded-xl border border-border bg-card p-2 shadow-xl shadow-black/10"
        >
          {/* Identity header */}
          <div className="flex items-center gap-3 px-3 py-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
              {initialsOf(displayName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
            <span className="ml-auto shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              {ROLE_LABELS[role] ?? 'Member'}
            </span>
          </div>

          <div className="my-1 h-px bg-border" />

          <Link href="/settings" onClick={() => setIsOpen(false)} className={itemClass}>
            <Settings className="h-4 w-4 text-muted-foreground" />
            Settings
          </Link>

          <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Personal Tools
          </p>
          <button onClick={() => fireEvent('timer:open-quick-start')} className={itemClass}>
            <Clock className="h-4 w-4 text-muted-foreground" />
            Track Time
          </button>
          <button onClick={() => fireEvent('notepad:open')} className={itemClass}>
            <NotebookPen className="h-4 w-4 text-muted-foreground" />
            Notepad
          </button>
          <button onClick={() => fireEvent('reminders:open')} className={itemClass}>
            <AlarmClock className="h-4 w-4 text-muted-foreground" />
            Reminders
            {overdueCount > 0 && (
              <span className="ml-auto rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
                {overdueCount}
              </span>
            )}
          </button>
          <Link href="/tasks" onClick={() => setIsOpen(false)} className={itemClass}>
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
            My Tasks
          </Link>
          <button onClick={() => fireEvent('feedback:open')} className={itemClass}>
            <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
            Send Feedback
          </button>

          <div className="my-1 h-px bg-border" />

          <button className={itemClass} title="Help Guides">
            <HelpCircle className="h-4 w-4 text-muted-foreground" />
            Help
          </button>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { GlobalSearch } from '@/components/dashboard/GlobalSearch';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { UserMenu } from '@/components/dashboard/UserMenu';

export function TopNav() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Global shortcuts. Single owner: moved here from Sidebar.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
      // Cmd+Shift+T — open floating timer quick-start
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 't') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('timer:open-quick-start'));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <header className="hidden lg:flex h-14 shrink-0 items-center gap-4 border-b border-border bg-card px-4">
      <div className="flex-1" />

      <button
        onClick={() => setIsSearchOpen(true)}
        className="flex w-full max-w-md items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium">
          ⌘K
        </kbd>
      </button>

      <div className="flex flex-1 items-center justify-end gap-1">
        <NotificationBell />
        <UserMenu />
      </div>

      <GlobalSearch isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </header>
  );
}

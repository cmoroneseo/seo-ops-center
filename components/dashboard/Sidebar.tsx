'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CheckSquare, FileBarChart, MessageSquare, Settings, LogOut, Briefcase, Search, HelpCircle, History, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { OrganizationSwitcher } from '@/components/organization-switcher';
import { TimeLogModal } from '@/components/workspace/TimeLogModal';
import { GlobalSearch } from '@/components/dashboard/GlobalSearch';
import { mockClients } from '@/lib/mock-data/workspace';
import { useState, useEffect } from 'react';

const navigation = [
  { name: 'Home', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Workspace', href: '/workspace', icon: Briefcase },
  { name: 'Analytics', href: '/analytics', icon: FileBarChart },
  { name: 'Tasks', href: '/tasks', icon: CheckSquare },
  { name: 'Messages', href: '/messages', icon: MessageSquare },
  { name: 'History', href: '/history', icon: History },
  { name: 'Documents', href: '/documents', icon: FileText },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [isTimeLogOpen, setIsTimeLogOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex h-full w-20 flex-col bg-card border-r border-border items-center py-6">
      <div className="mb-8">
        <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-primary-foreground font-bold text-xl shadow-lg shadow-primary/20">
          A
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center gap-4 w-full px-2">
        {navigation.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'relative group flex items-center justify-center h-12 w-12 rounded-xl transition-all duration-200',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                  : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
              )}
            >
              <item.icon className="h-6 w-6" />

              {/* Tooltip */}
              <div className="absolute left-16 px-2 py-1 bg-popover text-popover-foreground text-xs font-medium rounded border border-border opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                {item.name}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-4 pb-4">
        <button
          onClick={() => setIsSearchOpen(true)}
          className="h-12 w-12 flex items-center justify-center rounded-xl bg-red-500 text-white shadow-lg shadow-red-500/20 hover:scale-105 transition-transform"
        >
          <Search className="h-6 w-6" />
        </button>

        <button
          className="h-12 w-12 flex items-center justify-center rounded-xl bg-accent/20 text-muted-foreground hover:bg-accent/30 transition-colors"
          title="Help Guides"
        >
          <HelpCircle className="h-6 w-6" />
        </button>

        <button
          onClick={async () => {
            const { createClient } = await import('@/lib/supabase/client');
            const supabase = createClient();
            if (supabase) {
              await supabase.auth.signOut();
              window.location.href = '/';
            }
          }}
          className="h-12 w-12 flex items-center justify-center rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          title="Sign Out"
        >
          <LogOut className="h-6 w-6" />
        </button>
      </div>

      <GlobalSearch
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />

      <TimeLogModal
        isOpen={isTimeLogOpen}
        onClose={() => setIsTimeLogOpen(false)}
        clients={mockClients}
      />
    </div>
  );
}

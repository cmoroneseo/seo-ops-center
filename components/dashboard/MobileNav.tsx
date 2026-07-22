'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Menu, X, Search, LogOut, Users, Settings,
  LayoutDashboard, Briefcase, CheckSquare, PackageCheck, MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { navigation } from '@/components/dashboard/Sidebar';
import { UserMenu } from '@/components/dashboard/UserMenu';
import { ClientListPanel } from '@/components/workspace/ClientListPanel';
import { GlobalSearch } from '@/components/dashboard/GlobalSearch';
import { NotificationBell } from '@/components/notifications/NotificationBell';

// Primary destinations surfaced in the bottom tab bar (one-handed reach).
const primaryTabs = [
  { name: 'Home', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Clients', href: '/workspace', icon: Briefcase },
  { name: 'Tasks', href: '/tasks', icon: CheckSquare },
  { name: 'Deliver', href: '/deliverables', icon: PackageCheck },
];

// Drawer shows all pages; Settings lives here now that the rail dropped it
// (desktop reaches it via the user menu).
const drawerNavigation = [
  ...navigation,
  { name: 'Settings', href: '/settings', icon: Settings },
];

function isActiveHref(pathname: string, href: string) {
  return pathname === href || (href !== '/' && pathname?.startsWith(href));
}

export function MobileNav({ showClientList }: { showClientList: boolean }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [clientsOpen, setClientsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Close drawers on route change.
  useEffect(() => {
    setMenuOpen(false);
    setClientsOpen(false);
  }, [pathname]);

  // Lock body scroll while a drawer is open.
  useEffect(() => {
    const open = menuOpen || clientsOpen;
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen, clientsOpen]);

  async function signOut() {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    if (supabase) {
      await supabase.auth.signOut();
      window.location.href = '/';
    }
  }

  return (
    <>
      {/* Top bar */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-card/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 pt-[env(safe-area-inset-top)]">
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted active:scale-95 transition"
        >
          <Menu className="h-6 w-6" />
        </button>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground shadow-sm">
          A
        </div>
        <div className="ml-auto flex items-center gap-1">
          {showClientList && (
            <button
              onClick={() => setClientsOpen(true)}
              aria-label="Browse clients"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted active:scale-95 transition"
            >
              <Users className="h-6 w-6" />
            </button>
          )}
          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted active:scale-95 transition"
          >
            <Search className="h-6 w-6" />
          </button>
          <div className="flex h-11 w-11 items-center justify-center">
            <NotificationBell />
          </div>
          <UserMenu />
        </div>
      </header>

      {/* Bottom tab bar */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 pb-[env(safe-area-inset-bottom)]">
        {primaryTabs.map((tab) => {
          const active = isActiveHref(pathname, tab.href);
          return (
            <Link
              key={tab.name}
              href={tab.href}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <tab.icon className="h-5 w-5" />
              {tab.name}
            </Link>
          );
        })}
        <button
          onClick={() => setMenuOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-muted-foreground"
        >
          <MoreHorizontal className="h-5 w-5" />
          More
        </button>
      </nav>

      {/* Full-menu drawer */}
      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} side="left" title="Menu">
        <div className="flex-1 overflow-y-auto p-2">
          {drawerNavigation.map((item) => {
            const active = isActiveHref(pathname, item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors',
                  active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {item.name}
              </Link>
            );
          })}
        </div>
        <div className="border-t border-border p-2">
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            Sign Out
          </button>
        </div>
      </Drawer>

      {/* Client list drawer */}
      <Drawer open={clientsOpen} onClose={() => setClientsOpen(false)} side="left" title="Clients" noPadding>
        <ClientListPanel variant="drawer" onNavigate={() => setClientsOpen(false)} />
      </Drawer>

      <GlobalSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}

function Drawer({
  open, onClose, side, title, noPadding, children,
}: {
  open: boolean;
  onClose: () => void;
  side: 'left' | 'right';
  title: string;
  noPadding?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('lg:hidden fixed inset-0 z-50', open ? '' : 'pointer-events-none')}>
      <div
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-black/50 transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0'
        )}
      />
      <div
        className={cn(
          'absolute top-0 bottom-0 flex w-[84%] max-w-sm flex-col bg-card shadow-xl transition-transform duration-200 ease-out',
          side === 'left' ? 'left-0' : 'right-0',
          open ? 'translate-x-0' : side === 'left' ? '-translate-x-full' : 'translate-x-full'
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 pt-[env(safe-area-inset-top)]">
          <span className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted active:scale-95 transition"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className={cn('flex flex-1 flex-col overflow-hidden', noPadding ? '' : '')}>
          {children}
        </div>
      </div>
    </div>
  );
}

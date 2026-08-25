'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Menu, X, Search, LogOut, Users, Settings, Check,
  LayoutDashboard, Briefcase, CheckSquare, PackageCheck, MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { navigation } from '@/components/dashboard/Sidebar';
import { UserMenu } from '@/components/dashboard/UserMenu';
import { ClientListPanel } from '@/components/workspace/ClientListPanel';
import { GlobalSearch } from '@/components/dashboard/GlobalSearch';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { useOrganization } from '@/components/providers/organization-provider';

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
  const { organization, memberships, setOrganization } = useOrganization();
  const [menuOpen, setMenuOpen] = useState(false);
  const [clientsOpen, setClientsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Only worth showing the tenant switcher when there is somewhere to switch to.
  const switchableOrgs = memberships
    .map((m) => m.organization)
    .filter((o): o is NonNullable<typeof o> => o !== null && o !== undefined);
  const showOrgSwitcher = switchableOrgs.length > 1;

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
        {/* Tapping the mark opens the menu, where the tenant can be switched.
            The name only earns its space when more than one org exists. */}
        <button
          onClick={() => setMenuOpen(true)}
          aria-label={organization ? `Organization: ${organization.name}` : 'Organization'}
          className="flex min-w-0 items-center gap-2 rounded-lg py-1 pr-1 active:scale-95 transition"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground shadow-sm">
            {organization?.name?.charAt(0).toUpperCase() ?? 'A'}
          </span>
          {showOrgSwitcher && organization && (
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">
              {organization.name}
            </span>
          )}
        </button>
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
          {/* Tenant switcher — desktop has this in the top nav; on mobile it
              lives here so the crowded top bar stays legible. */}
          {showOrgSwitcher && (
            <div className="mb-2 border-b border-border pb-2">
              <span className="block px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Organization
              </span>
              {switchableOrgs.map((org) => {
                const current = organization?.id === org.id;
                return (
                  <button
                    key={org.id}
                    onClick={() => {
                      if (!current) setOrganization(org);
                      setMenuOpen(false);
                    }}
                    aria-current={current ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition-colors',
                      current ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'
                    )}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
                      {org.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{org.name}</span>
                    {current && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}

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

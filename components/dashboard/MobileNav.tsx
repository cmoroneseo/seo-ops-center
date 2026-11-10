'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import {
    Menu, X, Search, LogOut, Check,
    LayoutDashboard, Briefcase, CheckSquare, PackageCheck, MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UserMenu } from '@/components/dashboard/UserMenu';
import { GlobalSearch } from '@/components/dashboard/GlobalSearch';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { useOrganization } from '@/components/providers/organization-provider';
import { useClients } from '@/lib/hooks/use-clients';
import { keywordTrackingEnabled } from '@/lib/keyword-tracking/flag';
import { campaignWorkspaceEnabled } from '@/lib/campaign-workspace/flag';
import { pipelineNavEnabled } from '@/lib/nav/pipeline-flag';
import { useAgencyDashboardEnabled } from '@/components/agency-dashboard/use-enabled';
import { useVaultEnabled } from '@/components/vault/use-vault-enabled';
import {
    agencyLinks,
    clientInitials,
    clientSections,
    clientStatusChip,
    FOOTER_LINKS,
    isAgencyLinkActive,
    isClientLinkActive,
    switchClientHref,
} from '@/lib/nav/staff-shell';
import { ClientSwitcherPanel } from '@/components/dashboard/ClientSwitcher';
import { useSelectedClient } from '@/components/dashboard/use-selected-client';

const primaryTabs = [
    { name: 'Home', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Clients', href: '/workspace', icon: Briefcase },
    { name: 'Tasks', href: '/tasks', icon: CheckSquare },
    { name: 'Deliver', href: '/deliverables', icon: PackageCheck },
];

function isActiveHref(pathname: string, href: string) {
    return pathname === href || (href !== '/' && pathname.startsWith(href));
}

export function MobileNav() {
    const pathname = usePathname();
    const { organization, memberships, setOrganization } = useOrganization();
    const { clients } = useClients({ statuses: ['Active', 'Onboarding', 'Paused', 'Cancelled'] });
    const selected = useSelectedClient();
    const agencyDashboard = useAgencyDashboardEnabled();
    const vaultEnabled = useVaultEnabled(organization?.id) === true;
    const keywordTracking = keywordTrackingEnabled();
    const campaignWorkspace = campaignWorkspaceEnabled();
    const pipelineNav = pipelineNavEnabled();
    const [menuOpen, setMenuOpen] = useState(false);
    const [selectorOpen, setSelectorOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);

    const switchableOrgs = memberships
        .map((membership) => membership.organization)
        .filter((org): org is NonNullable<typeof org> => org !== null && org !== undefined);
    const showOrgSwitcher = switchableOrgs.length > 1;
    const flags = { keywordTracking, vault: vaultEnabled, campaignWorkspace, pipelineNav };
    const selectedClient = clients.find(client => client.id === selected.clientId) ?? null;
    const sections = selected.clientId
        ? clientSections(selected.clientId, flags)
        : [];
    const agency = agencyLinks({ agencyDashboard });

    function hrefFor(clientId: string) {
        return switchClientHref({
            fromPathname: selected.pathname,
            fromSearch: selected.search,
            targetClientId: clientId,
            keywordTracking,
            vaultEnabled,
            campaignWorkspace,
        });
    }

    useEffect(() => {
        setMenuOpen(false);
        setSelectorOpen(false);
    }, [pathname]);

    useEffect(() => {
        const open = menuOpen || selectorOpen;
        document.body.style.overflow = open ? 'hidden' : '';
        return () => { document.body.style.overflow = ''; };
    }, [menuOpen, selectorOpen]);

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
            <header className="lg:hidden fixed top-0 inset-x-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-card/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 pt-[env(safe-area-inset-top)]">
                <button
                    onClick={() => setMenuOpen(true)}
                    aria-label="Open menu"
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted active:scale-95 transition"
                >
                    <Menu className="h-6 w-6" />
                </button>
                <button
                    onClick={() => setSelectorOpen(true)}
                    aria-label={selectedClient ? `Client: ${selectedClient.clientName}` : 'Select a client'}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 pr-1 text-left active:scale-95 transition"
                >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-[11px] font-semibold text-primary">
                        {selectedClient ? clientInitials(selectedClient.clientName) : (selected.clientId ? '?' : '—')}
                    </span>
                    <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-foreground">
                            {selectedClient?.clientName ?? (selected.clientId ? 'Unknown client' : 'No client')}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                            {selectedClient ? clientStatusChip(selectedClient) : (selected.clientId ? 'Not in this list' : 'Agency home')}
                        </span>
                    </span>
                </button>
                <div className="ml-auto flex items-center gap-1">
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

            <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} side="left" title="Menu">
                <div className="flex-1 overflow-y-auto p-2">
                    {organization && !showOrgSwitcher && (
                        <p className="mb-2 border-b border-border px-3 pb-2 text-[11px] text-muted-foreground">
                            {organization.name}
                        </p>
                    )}
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

                    {sections.map(section => (
                        <div key={section.id} className="mb-2">
                            <span className="block px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                {section.label}
                            </span>
                            {section.links.map(link => {
                                const active = isClientLinkActive(pathname, selected.search, link, flags);
                                const children = link.children ?? [];
                                const item = (
                                    <Link
                                        key={link.id}
                                        href={link.href}
                                        onClick={() => setMenuOpen(false)}
                                        aria-current={active ? 'page' : undefined}
                                        className={cn(
                                            'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors',
                                            active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'
                                        )}
                                    >
                                        {link.label}
                                    </Link>
                                );
                                if (children.length === 0) return item;
                                return (
                                    <div key={link.id}>
                                        {item}
                                        {children.map(child => {
                                            const childActive = isClientLinkActive(pathname, selected.search, child, flags);
                                            return (
                                                <Link
                                                    key={child.id}
                                                    href={child.href}
                                                    onClick={() => setMenuOpen(false)}
                                                    aria-current={childActive ? 'page' : undefined}
                                                    className={cn(
                                                        'flex items-center gap-3 rounded-xl px-6 py-3 text-sm font-medium transition-colors',
                                                        childActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'
                                                    )}
                                                >
                                                    {child.label}
                                                </Link>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                            {section.overflow?.map(link => {
                                const active = isClientLinkActive(pathname, selected.search, link, flags);
                                return (
                                    <Link
                                        key={link.id}
                                        href={link.href}
                                        onClick={() => setMenuOpen(false)}
                                        aria-current={active ? 'page' : undefined}
                                        className={cn(
                                            'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors',
                                            active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'
                                        )}
                                    >
                                        {link.label}
                                    </Link>
                                );
                            })}
                        </div>
                    ))}

                    <div className="mb-2">
                        <span className="block px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Agency
                        </span>
                        {agency.map(link => {
                            const active = isAgencyLinkActive(pathname, link.href);
                            return (
                                <span key={link.id} className="block">
                                    <Link
                                        href={link.href}
                                        onClick={() => setMenuOpen(false)}
                                        aria-current={active ? 'page' : undefined}
                                        className={cn(
                                            'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors',
                                            active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'
                                        )}
                                    >
                                        {link.label}
                                    </Link>
                                    {link.dividerAfter && <div className="mx-3 my-1 h-px bg-border" />}
                                </span>
                            );
                        })}
                        {FOOTER_LINKS.map(link => {
                            const active = isAgencyLinkActive(pathname, link.href);
                            return (
                                <Link
                                    key={link.id}
                                    href={link.href}
                                    onClick={() => setMenuOpen(false)}
                                    aria-current={active ? 'page' : undefined}
                                    className={cn(
                                        'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors',
                                        active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'
                                    )}
                                >
                                    {link.label}
                                </Link>
                            );
                        })}
                    </div>
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

            {selectorOpen && (
                <div className="lg:hidden fixed inset-0 z-50">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setSelectorOpen(false)} />
                    <div className="absolute inset-x-0 top-0 flex max-h-[85vh] flex-col bg-card shadow-xl pt-[env(safe-area-inset-top)]">
                        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
                            <span className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Clients</span>
                            <button
                                onClick={() => setSelectorOpen(false)}
                                aria-label="Close"
                                className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted"
                            >
                                <X className="h-6 w-6" />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto">
                            <Suspense fallback={null}>
                                <ClientSwitcherPanel
                                    clients={clients.map(client => ({
                                        id: client.id,
                                        name: client.clientName,
                                        chip: clientStatusChip(client),
                                        logoUrl: client.logoUrl,
                                    }))}
                                    selectedId={selected.clientId}
                                    recentIds={selected.recentIds}
                                    hrefFor={hrefFor}
                                    onClear={selected.clear}
                                    onNavigate={() => setSelectorOpen(false)}
                                />
                            </Suspense>
                        </div>
                    </div>
                </div>
            )}

            <GlobalSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
        </>
    );
}

function Drawer({
    open, onClose, side, title, children,
}: {
    open: boolean;
    onClose: () => void;
    side: 'left' | 'right';
    title: string;
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
                <div className="flex flex-1 flex-col overflow-hidden">
                    {children}
                </div>
            </div>
        </div>
    );
}

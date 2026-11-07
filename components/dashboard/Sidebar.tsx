'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
    Archive,
    Building2,
    CalendarRange,
    ChartNoAxesCombined,
    CheckSquare,
    ChevronDown,
    ClipboardList,
    Clock,
    FileCheck2,
    Flag,
    Globe,
    GraduationCap,
    Home,
    LayoutDashboard,
    Map,
    MoreHorizontal,
    PackageCheck,
    Plug,
    ScanSearch,
    Search,
    Settings,
    Target,
    Users,
    type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useClients } from '@/lib/hooks/use-clients';
import { keywordTrackingEnabled } from '@/lib/keyword-tracking/flag';
import { campaignWorkspaceEnabled } from '@/lib/campaign-workspace/flag';
import { useAgencyDashboardEnabled } from '@/components/agency-dashboard/use-enabled';
import { useVaultEnabled } from '@/components/vault/use-vault-enabled';
import { useOrganization } from '@/components/providers/organization-provider';
import {
    agencyLinks,
    clientSections,
    clientStatusChip,
    FOOTER_LINKS,
    isAgencyLinkActive,
    isClientLinkActive,
    switchClientHref,
    type StaffLink,
} from '@/lib/nav/staff-shell';
import { ClientSwitcher, type SwitcherClient } from '@/components/dashboard/ClientSwitcher';
import { useSelectedClient } from '@/components/dashboard/use-selected-client';

const ICONS: Record<string, LucideIcon> = {
    overview: LayoutDashboard,
    'campaign-workspace': Flag,
    plan: Target,
    tasks: CheckSquare,
    deliverables: PackageCheck,
    time: Clock,
    reports: ClipboardList,
    search: Search,
    rankings: ChartNoAxesCombined,
    'topical-map': Map,
    inventory: ScanSearch,
    approvals: FileCheck2,
    portal: Globe,
    integrations: Plug,
    vault: Archive,
    training: GraduationCap,
    settings: Settings,
    home: Home,
    dashboard: LayoutDashboard,
    clients: Users,
    planner: CalendarRange,
};

function RowIcon({ id }: { id: string }) {
    const Icon = ICONS[id] ?? LayoutDashboard;
    return <Icon className="h-4 w-4 shrink-0" aria-hidden />;
}

function navClass(active: boolean) {
    return cn(
        'relative flex h-9 w-full items-center gap-2.5 rounded-lg text-sm transition-colors',
        'justify-center px-0 xl:justify-start xl:px-2.5',
        active
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
    );
}

function NavLink({ link, active }: { link: StaffLink; active: boolean }) {
    return (
        <Link
            href={link.href}
            title={link.label}
            aria-current={active ? 'page' : undefined}
            className={navClass(active)}
        >
            {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" aria-hidden />}
            <RowIcon id={link.id} />
            <span className="hidden truncate xl:inline">{link.label}</span>
        </Link>
    );
}

export function Sidebar() {
    const { organization } = useOrganization();
    const { clients } = useClients({ statuses: ['Active', 'Onboarding', 'Paused', 'Cancelled'] });
    const selected = useSelectedClient();
    const agencyDashboard = useAgencyDashboardEnabled();
    const vaultEnabled = useVaultEnabled(organization?.id) === true;
    const keywordTracking = keywordTrackingEnabled();
    const campaignWorkspace = campaignWorkspaceEnabled();
    const [menu, setMenu] = useState<'clients' | 'agency' | 'more' | null>(null);
    const agencyRef = useRef<HTMLDivElement>(null);
    const moreRef = useRef<HTMLDivElement>(null);

    const switcherClients: SwitcherClient[] = clients.map(client => ({
        id: client.id,
        name: client.clientName,
        chip: clientStatusChip(client),
        logoUrl: client.logoUrl,
    }));
    const sections = selected.clientId
        ? clientSections(selected.clientId, { keywordTracking, vault: vaultEnabled, campaignWorkspace })
        : [];
    const agency = agencyLinks({ agencyDashboard });
    const flags = { keywordTracking, vault: vaultEnabled, campaignWorkspace };
    const agencyActive = agency.some(link => isAgencyLinkActive(selected.pathname, link.href));

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
        setMenu(null);
    }, [selected.pathname, selected.search]);

    useEffect(() => {
        if (!menu) return;
        const close = (event: MouseEvent) => {
            const target = event.target as Node;
            if (menu === 'agency' && agencyRef.current?.contains(target)) return;
            if (menu === 'more' && moreRef.current?.contains(target)) return;
            if (menu === 'clients') return;
            setMenu(null);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setMenu(null);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', onKey);
        };
    }, [menu]);

    return (
        <aside className="relative z-40 hidden h-full w-[72px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex xl:w-64">
            <div className="shrink-0 space-y-2 p-2 xl:p-3">
                <Link
                    href="/dashboard"
                    title="SEO Ops"
                    className="flex items-center gap-2.5 rounded-lg px-0 py-1 xl:px-1"
                >
                    <span className="mx-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground xl:mx-0">
                        A
                    </span>
                    <span className="hidden min-w-0 xl:block">
                        <span className="block text-sm font-semibold leading-tight">SEO Ops</span>
                        <span className="block text-[11px] text-muted-foreground">Agency workspace</span>
                    </span>
                </Link>

                <ClientSwitcher
                    clients={switcherClients}
                    selectedId={selected.clientId}
                    recentIds={selected.recentIds}
                    hrefFor={hrefFor}
                    onClear={selected.clear}
                    open={menu === 'clients'}
                    onOpenChange={open => setMenu(open ? 'clients' : null)}
                />

                <div ref={agencyRef} className="relative">
                    <button
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={menu === 'agency'}
                        title="Agency"
                        onClick={() => setMenu(menu === 'agency' ? null : 'agency')}
                        className={navClass(agencyActive || menu === 'agency')}
                    >
                        {(agencyActive || menu === 'agency') && (
                            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" aria-hidden />
                        )}
                        <Building2 className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="hidden flex-1 truncate text-left xl:inline">Agency</span>
                        <ChevronDown className={cn('hidden h-3.5 w-3.5 shrink-0 xl:block', menu === 'agency' && 'rotate-180')} />
                    </button>
                    {menu === 'agency' && (
                        <div role="menu" className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg xl:right-0 xl:w-auto">
                            {agency.map(link => (
                                <span key={link.id} className="block">
                                    <Link
                                        role="menuitem"
                                        href={link.href}
                                        title={link.label}
                                        onClick={() => setMenu(null)}
                                        className={cn(
                                            'flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm',
                                            isAgencyLinkActive(selected.pathname, link.href)
                                                ? 'bg-primary/15 text-primary'
                                                : 'text-popover-foreground hover:bg-muted',
                                        )}
                                    >
                                        <RowIcon id={link.id} />
                                        {link.label}
                                    </Link>
                                    {link.dividerAfter && <div className="my-1 h-px bg-border" />}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-3" aria-label="Client">
                {sections.map(section => {
                    const overflowActive = section.overflow?.some(link => isClientLinkActive(selected.pathname, selected.search, link, flags)) ?? false;
                    return (
                        <div key={section.id} className="space-y-0.5">
                            <div className="hidden px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground xl:block">
                                {section.label}
                            </div>
                            {section.links.map(link => (
                                <NavLink
                                    key={link.id}
                                    link={link}
                                    active={isClientLinkActive(selected.pathname, selected.search, link, flags)}
                                />
                            ))}
                            {section.overflow && section.overflow.length > 0 && (
                                <div ref={moreRef}>
                                    <button
                                        type="button"
                                        title="More"
                                        aria-expanded={menu === 'more'}
                                        onClick={() => setMenu(current => current === 'more' ? null : 'more')}
                                        className={navClass(overflowActive)}
                                    >
                                        {(overflowActive) && (
                                            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" aria-hidden />
                                        )}
                                        <MoreHorizontal className="h-4 w-4 shrink-0" aria-hidden />
                                        <span className="hidden truncate xl:inline">More...</span>
                                    </button>
                                    {menu === 'more' && section.overflow.map(link => (
                                        <NavLink
                                            key={link.id}
                                            link={link}
                                            active={isClientLinkActive(selected.pathname, selected.search, link, flags)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>

            <div className="shrink-0 space-y-0.5 border-t border-sidebar-border p-2">
                {FOOTER_LINKS.map(link => (
                    <NavLink
                        key={link.id}
                        link={link}
                        active={isAgencyLinkActive(selected.pathname, link.href)}
                    />
                ))}
            </div>
        </aside>
    );
}

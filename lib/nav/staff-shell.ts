import { CAMPAIGN_WORKSPACE_TAB, isSeoPlanWorkspaceTab, seoPlanWorkSearch } from '@/lib/campaign-workspace/view';
import { reportsNavHref } from '@/lib/reports/close-nav';

/**
 * Variant B staff shell. Clients are the only switchable record.
 * Agency routes are the ones that already ship. Rankings is included
 * only when keyword tracking is exactly on. Campaign is included only
 * when the campaign workspace flag is exactly on, and that same switch
 * hides SEO Plan. The monthly board then lives on Campaign's Work tab.
 * Concept rows are omitted.
 *
 * `pipelineNav` regroups those same destinations into Client / Planning /
 * Delivery / More. Omitted, or anything but true, keeps the list below.
 */

export const AGENCY_HOME_HREF = '/dashboard';
export const ALL_CLIENTS_HREF = '/workspace';
export const STAFF_NAV_EVENT = 'staff-nav:url';
export const UNAVAILABLE_MODULE_NOTICE = "That section isn't available, so this opened Overview.";

export interface StaffLink {
    id: string;
    label: string;
    href: string;
    /** Workspace `tab` query this link owns. Absent for org routes. */
    tab?: string;
    /** Existing destinations listed under this row. Same routes, not new screens. */
    children?: StaffLink[];
}

export interface StaffSection {
    id: 'workspace' | 'search' | 'more' | 'client' | 'pipeline' | 'delivery';
    label: string;
    links: StaffLink[];
    /** Real destinations behind the More row. Not a second product area. */
    overflow?: StaffLink[];
}

export interface AgencyLink {
    id: string;
    label: string;
    href: string;
    dividerAfter?: boolean;
}

const KEEP_PARAMS = ['planView', 'phase', 'range', 'section', 'approvalBatch', 'campaignView'] as const;

type WorkspaceModule =
    | 'overview'
    | 'plan'
    | 'campaign-workspace'
    | 'tasks'
    | 'deliverables'
    | 'search'
    | 'rankings'
    | 'topical-map'
    | 'inventory'
    | 'approvals'
    | 'portal'
    | 'integrations'
    | 'vault';

function workspaceHref(clientId: string, tab: string, extra?: URLSearchParams): string {
    const params = new URLSearchParams();
    params.set('tab', tab);
    extra?.forEach((value, key) => {
        if (key !== 'tab') params.set(key, value);
    });
    return `/workspace/${encodeURIComponent(clientId)}?${params.toString()}`;
}

function tabOf(section: WorkspaceModule): string {
    if (section === 'plan') return 'campaign';
    if (section === 'search') return 'insights';
    return section;
}

function moduleOf(tab: string | null): WorkspaceModule | null {
    switch (tab) {
        case 'overview':
        case null:
        case '':
            return 'overview';
        case 'campaign':
        case 'plan':
            return 'plan';
        case 'campaign-workspace':
            return 'campaign-workspace';
        case 'tasks':
            return 'tasks';
        case 'deliverables':
            return 'deliverables';
        case 'insights':
            return 'search';
        case 'rankings':
            return 'rankings';
        case 'topical-map':
            return 'topical-map';
        case 'inventory':
            return 'inventory';
        case 'approvals':
            return 'approvals';
        case 'portal':
            return 'portal';
        case 'integrations':
            return 'integrations';
        case 'vault':
            return 'vault';
        default:
            return null;
    }
}

export function clientStatusChip(client: { engagementModel: string; status: string }): string {
    return `${client.engagementModel} · ${client.status}`;
}

export function clientInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1 || /^\d/.test(parts[0])) return parts[0].slice(0, 2).toUpperCase();
    return parts.slice(0, 2).map(part => part[0] ?? '').join('').toUpperCase() || '?';
}

export function clientSections(
    clientId: string,
    options: { keywordTracking: boolean; vault: boolean; campaignWorkspace: boolean; pipelineNav?: boolean },
): StaffSection[] {
    if (options.pipelineNav === true) return pipelineClientSections(clientId, options);

    const link = (id: string, label: string, section: WorkspaceModule): StaffLink => ({
        id,
        label,
        href: workspaceHref(clientId, tabOf(section)),
        tab: tabOf(section),
    });

    const search: StaffLink[] = [link('search', 'Search', 'search')];
    if (options.keywordTracking) search.push(link('rankings', 'Rankings', 'rankings'));

    const overflow: StaffLink[] = [
        link('inventory', 'Site pages', 'inventory'),
        link('approvals', 'Approvals', 'approvals'),
        link('portal', 'Client portal', 'portal'),
        link('integrations', 'Integrations', 'integrations'),
    ];
    if (options.vault) overflow.push(link('vault', 'Vault', 'vault'));

    const workspace: StaffLink[] = [link('overview', 'Overview', 'overview')];
    if (options.campaignWorkspace) {
        workspace.push(link('campaign-workspace', 'Campaign', 'campaign-workspace'));
    } else {
        workspace.push(link('plan', 'SEO Plan', 'plan'));
    }
    workspace.push(
        link('tasks', 'Tasks', 'tasks'),
        link('deliverables', 'Deliverables', 'deliverables'),
        { id: 'time', label: 'Time', href: '/timesheets' },
        { id: 'reports', label: 'Reports', href: reportsNavHref() },
    );

    return [
        {
            id: 'workspace',
            label: 'Client workspace',
            links: workspace,
        },
        { id: 'search', label: 'Search performance', links: search },
        {
            id: 'more',
            label: 'More',
            links: [link('topical-map', 'Topic map', 'topical-map')],
            overflow,
        },
    ];
}

/**
 * Same workspace routes, grouped as Client / Planning / Delivery / More.
 * Content is omitted until a workspace content tab exists. Approvals stays
 * on `?tab=approvals` and is not listed until that content surface can hold it.
 */
function pipelineClientSections(
    clientId: string,
    options: { keywordTracking: boolean; vault: boolean; campaignWorkspace: boolean },
): StaffSection[] {
    const link = (id: string, label: string, section: WorkspaceModule): StaffLink => ({
        id,
        label,
        href: workspaceHref(clientId, tabOf(section)),
        tab: tabOf(section),
    });

    const opportunities = link('opportunities', 'Opportunities', 'search');
    const nested: StaffLink[] = [link('inventory', 'Site pages', 'inventory')];
    if (options.keywordTracking) nested.push(link('rankings', 'Rankings', 'rankings'));
    opportunities.children = nested;

    const delivery: StaffLink[] = [];
    if (options.campaignWorkspace) {
        delivery.push(link('campaign-workspace', 'Campaign', 'campaign-workspace'));
    } else {
        delivery.push(link('plan', 'SEO Plan', 'plan'));
    }
    delivery.push(
        link('tasks', 'Tasks', 'tasks'),
        { id: 'reports', label: 'Reports', href: reportsNavHref() },
    );

    const more: StaffLink[] = [
        link('integrations', 'Integrations', 'integrations'),
        link('portal', 'Portal', 'portal'),
        link('deliverables', 'Deliverables', 'deliverables'),
    ];
    if (options.vault) more.push(link('vault', 'Vault', 'vault'));
    more.push({ id: 'time', label: 'Time', href: '/timesheets' });

    return [
        { id: 'client', label: 'Client', links: [link('overview', 'Overview', 'overview')] },
        {
            id: 'pipeline',
            label: 'Planning',
            links: [
                link('topical-map', 'Topic map', 'topical-map'),
                opportunities,
            ],
        },
        { id: 'delivery', label: 'Delivery', links: delivery },
        { id: 'more', label: 'More', links: more },
    ];
}

export function agencyLinks(options: { agencyDashboard: boolean }): AgencyLink[] {
    const links: AgencyLink[] = [
        { id: 'home', label: 'Agency home', href: AGENCY_HOME_HREF },
    ];
    if (options.agencyDashboard) {
        links.push({ id: 'dashboard', label: 'Dashboard', href: '/agency' });
    }
    links.push(
        { id: 'clients', label: 'All clients', href: ALL_CLIENTS_HREF, dividerAfter: true },
        { id: 'tasks', label: 'Tasks', href: '/tasks' },
        { id: 'deliverables', label: 'Deliverables', href: '/deliverables' },
        { id: 'time', label: 'Time', href: '/timesheets' },
        { id: 'planner', label: 'Planner', href: '/planner' },
        { id: 'reports', label: 'Reports', href: reportsNavHref() },
    );
    return links;
}

export const FOOTER_LINKS: StaffLink[] = [
    { id: 'training', label: 'Training', href: '/training' },
    { id: 'settings', label: 'Settings', href: '/settings' },
];

export function notifyStaffNav(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(STAFF_NAV_EVENT));
}

function paramsFrom(search: string): URLSearchParams {
    const raw = search.startsWith('?') ? search.slice(1) : search;
    return new URLSearchParams(raw);
}

export function isAgencyLinkActive(pathname: string, href: string): boolean {
    const path = href.split('?')[0] || '/';
    if (path === ALL_CLIENTS_HREF) return pathname === ALL_CLIENTS_HREF;
    if (path === '/reports' || path.startsWith('/reports/')) {
        return pathname === '/reports' || pathname.startsWith('/reports/');
    }
    return pathname === path || pathname.startsWith(`${path}/`);
}

export function isClientLinkActive(
    pathname: string,
    search: string,
    link: Pick<StaffLink, 'href' | 'tab'>,
    options: { keywordTracking: boolean; vault: boolean; campaignWorkspace: boolean },
): boolean {
    if (!link.tab) return false;
    if (!/^\/workspace\/([^/]+)/.test(pathname)) return false;
    const tab = paramsFrom(search).get('tab');
    if (link.tab === 'overview') {
        if (!tab || tab === 'overview') return true;
        if (tab === 'rankings' && !options.keywordTracking) return true;
        if (tab === 'vault' && !options.vault) return true;
        if (tab === 'campaign-workspace' && !options.campaignWorkspace) return true;
        return false;
    }
    if (link.tab === 'campaign') return tab === 'campaign' || tab === 'plan';
    if (link.tab === 'campaign-workspace') {
        return options.campaignWorkspace && (tab === 'campaign-workspace' || isSeoPlanWorkspaceTab(tab));
    }
    return tab === link.tab;
}

export interface SwitchClientInput {
    fromPathname: string;
    fromSearch: string;
    targetClientId: string;
    keywordTracking: boolean;
    vaultEnabled: boolean;
    campaignWorkspace: boolean;
}

/** Preserve the open module when that destination exists for the next client. */
export function switchClientHref(input: SwitchClientInput): string {
    const id = encodeURIComponent(input.targetClientId);
    if (input.fromPathname === '/tasks' || input.fromPathname.startsWith('/tasks/')) {
        return `/tasks?client=${id}`;
    }

    const onClient = /^\/workspace\/([^/]+)/.test(input.fromPathname);
    if (!onClient) return `/workspace/${id}?tab=overview`;

    const params = paramsFrom(input.fromSearch);
    const tab = params.get('tab');
    const current = moduleOf(tab);
    if (
        current == null
        || (current === 'rankings' && !input.keywordTracking)
        || (current === 'vault' && !input.vaultEnabled)
        || (current === 'campaign-workspace' && !input.campaignWorkspace)
    ) {
        return `/workspace/${id}?tab=overview&navNotice=unavailable`;
    }

    if (input.campaignWorkspace && current === 'plan') {
        const next = seoPlanWorkSearch(input.fromSearch, true);
        if (next) {
            const kept = new URLSearchParams(next);
            kept.delete('tab');
            return workspaceHref(input.targetClientId, CAMPAIGN_WORKSPACE_TAB, kept);
        }
    }

    const extra = new URLSearchParams();
    for (const key of KEEP_PARAMS) {
        const value = params.get(key);
        if (value) extra.set(key, value);
    }
    return workspaceHref(input.targetClientId, tabOf(current), extra);
}

import { orderedInitiatives, type CampaignInitiative, type InitiativeState } from '@/lib/campaign-workspace/initiatives';

export { PROJECT_STATUS } from '@/lib/projects/project-cards';

export const SIDEBAR_PROJECTS_LIMIT = 8;
export const PROJECTS_CHANGED_EVENT = 'seo-ops:projects-changed';

export function notifyProjectsChanged(clientId?: string) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(PROJECTS_CHANGED_EVENT, { detail: clientId }));
}

export function buildSidebarProjects(initiatives: readonly CampaignInitiative[], limit = SIDEBAR_PROJECTS_LIMIT) {
    const visible = orderedInitiatives(initiatives).slice(0, Math.max(0, limit));
    return { visible, total: initiatives.length, hasMore: visible.length < initiatives.length };
}

export const PROJECT_DOT_CLASS: Record<InitiativeState, string> = {
    planned: 'bg-zinc-400',
    in_progress: 'bg-blue-500',
    awaiting_approval: 'bg-amber-500',
    blocked: 'bg-rose-500',
    on_hold: 'bg-zinc-500',
    completed_verified: 'bg-emerald-500',
};

function projectsSearch(pathname: string, search: string, clientId: string): URLSearchParams | null {
    if (pathname !== `/workspace/${encodeURIComponent(clientId)}`) return null;
    const params = new URLSearchParams(search);
    return params.get('tab') === 'projects' ? params : null;
}

export function activeSidebarProjectId(pathname: string, search: string, clientId: string): string | null {
    return projectsSearch(pathname, search, clientId)?.get('projectId') || null;
}

export function isProjectsGridActive(pathname: string, search: string, clientId: string): boolean {
    const params = projectsSearch(pathname, search, clientId);
    return params !== null && !params.get('projectId');
}

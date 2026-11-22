'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useClientProjects } from '@/lib/hooks/use-client-projects';
import type { CampaignInitiative } from '@/lib/campaign-workspace/initiatives';
import {
    activeSidebarProjectId,
    buildSidebarProjects,
    isProjectsGridActive,
    PROJECT_DOT_CLASS,
    PROJECT_STATUS,
} from '@/lib/nav/sidebar-projects';
import { projectsHref } from '@/lib/projects/project-links';
import { cn } from '@/lib/utils';

interface SidebarProjectsProps {
    clientId: string;
    organizationId?: string | null;
    pathname: string;
    search: string;
    onNavigate?: () => void;
}

function NewProjectLink({ href, onNavigate }: { href: string; onNavigate?: () => void }) {
    return (
        <Link
            href={href}
            onClick={onNavigate}
            aria-label="New project"
            title="New project"
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground xl:size-7"
        >
            <Plus className="size-4" aria-hidden />
        </Link>
    );
}

export function SidebarProjects({ clientId, organizationId, pathname, search, onNavigate }: SidebarProjectsProps) {
    const { projects, loading, unavailable } = useClientProjects(clientId, organizationId);
    return (
        <SidebarProjectsList
            clientId={clientId}
            projects={projects}
            loading={loading}
            unavailable={unavailable}
            pathname={pathname}
            search={search}
            onNavigate={onNavigate}
        />
    );
}

export function SidebarProjectsList({
    clientId,
    projects,
    loading = false,
    unavailable = false,
    pathname,
    search,
    onNavigate,
}: {
    clientId: string;
    projects: readonly CampaignInitiative[];
    loading?: boolean;
    unavailable?: boolean;
    pathname: string;
    search: string;
    onNavigate?: () => void;
}) {
    const { visible } = buildSidebarProjects(projects);
    const gridHref = projectsHref(clientId);
    const createHref = projectsHref(clientId, { create: true });
    const activeId = activeSidebarProjectId(pathname, search, clientId);
    const gridActive = isProjectsGridActive(pathname, search, clientId);

    function rowClass(active: boolean) {
        return cn(
            'relative flex min-h-11 min-w-0 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors xl:min-h-9 xl:px-2.5',
            active
                ? 'bg-primary/15 text-primary before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground xl:hover:bg-sidebar-accent xl:hover:text-sidebar-foreground',
        );
    }

    return (
        <section aria-label="Projects" className="space-y-0.5">
            <div className="flex items-center justify-between px-3 xl:px-2.5">
                <Link href={gridHref} onClick={onNavigate} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                    Projects
                </Link>
                <NewProjectLink href={createHref} onNavigate={onNavigate} />
            </div>
            {loading && (
                <div role="status" aria-label="Checking projects" aria-busy="true">
                    {['w-28', 'w-20'].map(width => (
                        <div key={width} aria-hidden className={cn(rowClass(false), 'motion-safe:animate-pulse')}>
                            <span className="size-2 rounded-full bg-muted-foreground/20" />
                            <span className={cn('h-2.5 rounded bg-muted-foreground/20', width)} />
                        </div>
                    ))}
                </div>
            )}
            {visible.map(project => {
                const active = project.id === activeId;
                const status = PROJECT_STATUS[project.state].label;
                return (
                    <Link
                        key={project.id}
                        href={projectsHref(clientId, { projectId: project.id })}
                        onClick={onNavigate}
                        title={project.title}
                        aria-current={active ? 'page' : undefined}
                        className={rowClass(active)}
                    >
                        <span title={status} className={cn('size-2 shrink-0 rounded-full', PROJECT_DOT_CLASS[project.state])} aria-hidden />
                        <span className="truncate">{project.title}</span>
                        <span className="sr-only">{status}</span>
                    </Link>
                );
            })}
            {!loading && !unavailable && visible.length === 0 && (
                <div className="flex items-center justify-between px-3 text-xs text-muted-foreground xl:px-2.5">
                    <span>No projects yet</span>
                    <NewProjectLink href={createHref} onNavigate={onNavigate} />
                </div>
            )}
            <Link href={gridHref} onClick={onNavigate} aria-current={gridActive ? 'page' : undefined} className={rowClass(gridActive)}>
                All projects
            </Link>
        </section>
    );
}

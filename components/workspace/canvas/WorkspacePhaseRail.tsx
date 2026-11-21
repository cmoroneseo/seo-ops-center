'use client';

import Link from 'next/link';
import { projectsHref } from '@/lib/projects/project-links';
import { linkedTaskProgress, type PartOfChoice, type PartOfTask } from '@/lib/tasks/part-of';

export function WorkspacePhaseRail({ clientId, projects, tasks }: {
    projects: readonly PartOfChoice[];
    tasks: readonly PartOfTask[];
    clientId: string;
}) {
    return (
        <section aria-labelledby="workspace-projects-heading" className="rounded-xl border border-border bg-card p-4">
            <h2 id="workspace-projects-heading" className="mb-3 text-sm font-medium">Projects</h2>
            {projects.length === 0 ? (
                <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">No projects yet</p>
                    <Link href={projectsHref(clientId, { create: true })} className="text-sm font-medium text-primary hover:underline">Create your first project</Link>
                </div>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {projects.map(project => {
                        const progress = linkedTaskProgress(project.id, tasks);
                        return (
                            <Link
                                key={project.id}
                                href={projectsHref(clientId, { projectId: project.id })}
                                className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-left hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <span className="block text-sm font-medium">{project.title}</span>
                                <span className="mt-1 block text-xs text-muted-foreground">
                                    {progress?.done ?? 0} / {progress?.total ?? 0} done
                                </span>
                            </Link>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

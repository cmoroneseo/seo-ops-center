import { projectsHref } from '../projects/project-links';

export interface TaskHit {
    id: string;
    clientId: string | null;
    title: string;
    clientName: string | null;
    statusLabel: string;
}

export interface ProjectHit extends TaskHit {
    clientId: string;
}

export interface OrgSearchHits {
    projects: ProjectHit[];
    tasks: TaskHit[];
}

export type CommandPaletteProjectItem = ProjectHit & { href: string };
export type CommandPaletteTaskItem = TaskHit & { href: string };

export function escapeLikePattern(text: string): string {
    return text.replace(/[\\%_]/g, '\\$&');
}

export function searchCommandResults({ projects, tasks }: OrgSearchHits) {
    return {
        projects: projects.map((project): CommandPaletteProjectItem => ({
            ...project,
            href: projectsHref(project.clientId, { projectId: project.id }),
        })),
        tasks: tasks.map((task): CommandPaletteTaskItem => ({
            ...task,
            href: `/tasks?task=${encodeURIComponent(task.id)}`,
        })),
    };
}

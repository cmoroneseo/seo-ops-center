import { projectsHref } from '../projects/project-links.ts';

const DEFAULT_SITE_URL = 'https://seo-ops-center.vercel.app';

export function botTaskLinks(
    task: { id: string; clientId?: string; initiativeId?: string | null },
    siteUrl?: string,
) {
    const base = (siteUrl || DEFAULT_SITE_URL).replace(/\/+$/, '');
    return {
        url: `${base}/tasks?task=${encodeURIComponent(task.id)}`,
        ...(task.initiativeId && task.clientId
            ? { projectUrl: `${base}${projectsHref(task.clientId, { projectId: task.initiativeId })}` }
            : {}),
    };
}

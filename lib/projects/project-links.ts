export function projectsHref(clientId: string, options?: { projectId: string } | { create: true }) {
    const query = new URLSearchParams({ tab: 'projects' });
    if (options && 'projectId' in options) query.set('projectId', options.projectId);
    if (options && 'create' in options) query.set('newProject', '1');
    return `/workspace/${encodeURIComponent(clientId)}?${query}`;
}

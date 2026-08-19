import {
    resolveBasecampProjectAccess,
    scopeBasecampProjects,
    type BasecampProjectAccessSource,
} from './project-access.ts';

export type { BasecampProjectAccessSource } from './project-access.ts';

interface BasecampProject {
    id: string | number;
    name: string;
    description: string;
    status: string;
}

interface BasecampProjectCatalog {
    isConfigured(): boolean;
    listProjects(): Promise<BasecampProject[]>;
}

export interface BasecampProjectsGetDependencies {
    getUserId(): Promise<string | null>;
    createAccessSource(): BasecampProjectAccessSource;
    createCatalog(): BasecampProjectCatalog;
}

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
}

export function createBasecampProjectsGet(dependencies: BasecampProjectsGetDependencies) {
    return async function getBasecampProjects(req: Request): Promise<Response> {
        try {
            const userId = await dependencies.getUserId();
            if (!userId) return json({ error: 'Unauthorized' }, 401);

            const organizationId = new URL(req.url).searchParams.get('organizationId')?.trim();
            if (!organizationId) return json({ error: 'organizationId required' }, 400);

            const access = await resolveBasecampProjectAccess(
                { userId, organizationId },
                dependencies.createAccessSource(),
            );
            if (!access.ok) return json({ error: access.error }, access.status);

            const catalog = dependencies.createCatalog();
            if (!catalog.isConfigured()) {
                return json({
                    error: 'Basecamp not configured. Add BASECAMP_ACCESS_TOKEN and BASECAMP_ACCOUNT_ID to your Vercel environment variables.',
                    configured: false,
                }, 503);
            }

            if (!access.canEnumerateCatalog && access.allowedProjectIds.length === 0) {
                return json({ projects: [], configured: true });
            }

            const projects = scopeBasecampProjects(await catalog.listProjects(), access);
            return json({ projects, configured: true });
        } catch {
            return json({ error: 'Unable to verify organization access' }, 500);
        }
    };
}

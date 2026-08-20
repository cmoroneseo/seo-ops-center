import {
    authorizeBasecampProject,
    normalizeBasecampProjectId,
    type BasecampProjectAccessSource,
} from './project-access.ts';

type ClientAuthorization =
    | {
        ok: true;
        userId: string;
        actorName: string;
        organizationId: string;
        clientId: string;
        role: 'owner' | 'admin' | 'member' | 'viewer';
        canManageIntegrations: boolean;
    }
    | { ok: false; status: number; error: string };

interface ClientConfigRecord {
    id: string;
    name: string;
    organizationId: string;
    customFields: Record<string, unknown>;
}

interface ConfigStore {
    getClient(clientId: string, organizationId: string): Promise<ClientConfigRecord | null>;
    updateClientCustomFields(
        clientId: string,
        organizationId: string,
        customFields: Record<string, unknown>,
    ): Promise<string | null>;
    logActivity(payload: {
        organizationId: string;
        clientId: string;
        eventType: string;
        actorId: string;
        actorName: string;
        metadata: Record<string, unknown>;
    }): Promise<void>;
}

interface Project {
    id: string | number;
    name: string;
    description: string;
    status: string;
}

interface Todolist {
    id: string | number;
    title: string;
    name: string;
    todos_count: number;
}

interface Dependencies {
    authorizeClient(clientId: string): Promise<ClientAuthorization>;
    createStore(): ConfigStore;
    createAccessSource(): BasecampProjectAccessSource;
    isConfigured(): boolean;
    listProjects(): Promise<Project[]>;
    listTodolists(projectId: string): Promise<Todolist[]>;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

function normalizeOptionalId(value: unknown): string | null | 'invalid' {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string' && typeof value !== 'number') return 'invalid';
    const normalized = String(value).trim();
    return /^\d+$/.test(normalized) ? normalized : 'invalid';
}

export function createBasecampConfigHandlers(dependencies: Dependencies) {
    async function authorize(clientId: string) {
        const authorization = await dependencies.authorizeClient(clientId);
        if (!authorization.ok) {
            return {
                ok: false as const,
                response: json({ error: authorization.error }, authorization.status),
            };
        }
        return { ok: true as const, authorization };
    }

    return {
        async get(_req: Request, clientId: string): Promise<Response> {
            try {
                const result = await authorize(clientId);
                if (!result.ok) return result.response;

                const store = dependencies.createStore();
                const client = await store.getClient(
                    result.authorization.clientId,
                    result.authorization.organizationId,
                );
                if (!client) return json({ error: 'Client not found' }, 404);

                const fields = client.customFields;
                return json({
                    basecamp_project_id: fields.basecamp_project_id ?? '',
                    basecamp_todolist_id: fields.basecamp_todolist_id ?? '',
                    basecamp_sync_enabled: fields.basecamp_sync_enabled ?? false,
                    basecamp_timesheet_enabled: fields.basecamp_timesheet_enabled ?? false,
                });
            } catch {
                return json({ error: 'Unable to load Basecamp configuration' }, 500);
            }
        },

        async post(req: Request, clientId: string): Promise<Response> {
            try {
                const result = await authorize(clientId);
                if (!result.ok) return result.response;

                const body = await req.json() as Record<string, unknown>;
                const requestedProjectId = normalizeOptionalId(body.basecamp_project_id);
                const requestedTodolistId = normalizeOptionalId(body.basecamp_todolist_id);
                if (requestedProjectId === 'invalid') {
                    return json({ error: 'Valid basecamp_project_id required' }, 400);
                }
                if (requestedTodolistId === 'invalid') {
                    return json({ error: 'Valid basecamp_todolist_id required' }, 400);
                }
                if (!requestedProjectId && requestedTodolistId) {
                    return json({ error: 'A todolist requires a project' }, 400);
                }

                const store = dependencies.createStore();
                const client = await store.getClient(
                    result.authorization.clientId,
                    result.authorization.organizationId,
                );
                if (!client) return json({ error: 'Client not found' }, 404);

                const currentProjectId = normalizeBasecampProjectId(
                    client.customFields.basecamp_project_id as string | number | null | undefined,
                );

                if (requestedProjectId) {
                    const access = await authorizeBasecampProject(
                        {
                            userId: result.authorization.userId,
                            organizationId: result.authorization.organizationId,
                            projectId: requestedProjectId,
                        },
                        dependencies.createAccessSource(),
                    );
                    if (!access.ok) return json({ error: access.error }, access.status);

                    if (!access.canEnumerateCatalog && requestedProjectId !== currentProjectId) {
                        return json({ error: 'External organizations may only preserve or clear an existing project binding' }, 403);
                    }

                    if (!dependencies.isConfigured()) {
                        return json({ error: 'Basecamp not configured', configured: false }, 503);
                    }

                    if (access.canEnumerateCatalog) {
                        const catalog = await dependencies.listProjects();
                        if (!catalog.some(project => String(project.id) === requestedProjectId)) {
                            return json({ error: 'Project is not in the trusted catalog' }, 403);
                        }
                    }

                    if (requestedTodolistId) {
                        const todolists = await dependencies.listTodolists(requestedProjectId);
                        if (!todolists.some(list => String(list.id) === requestedTodolistId)) {
                            return json({ error: 'Todolist is not authorized' }, 403);
                        }
                    }
                }

                const wasEnabled = client.customFields.basecamp_sync_enabled === true;
                const hadProject = currentProjectId !== null;
                const projectChanged = requestedProjectId !== currentProjectId;
                const updatedFields: Record<string, unknown> = {
                    ...client.customFields,
                    basecamp_project_id: requestedProjectId,
                    basecamp_todolist_id: requestedProjectId ? requestedTodolistId : null,
                    basecamp_sync_enabled: requestedProjectId ? body.basecamp_sync_enabled === true : false,
                    basecamp_timesheet_enabled: requestedProjectId ? body.basecamp_timesheet_enabled === true : false,
                };
                if (projectChanged) updatedFields.basecamp_timesheet_recording_id = null;

                const updateError = await store.updateClientCustomFields(
                    result.authorization.clientId,
                    result.authorization.organizationId,
                    updatedFields,
                );
                if (updateError) return json({ error: updateError }, 500);

                const syncEnabled = updatedFields.basecamp_sync_enabled === true;
                const eventType = wasEnabled && !syncEnabled
                    ? 'integration.disconnected'
                    : !hadProject && requestedProjectId
                    ? 'integration.connected'
                    : 'integration.reconfigured';
                await store.logActivity({
                    organizationId: result.authorization.organizationId,
                    clientId: result.authorization.clientId,
                    eventType,
                    actorId: result.authorization.userId,
                    actorName: result.authorization.actorName,
                    metadata: {
                        service: 'basecamp',
                        basecamp_project_id: requestedProjectId,
                        basecamp_todolist_id: requestedProjectId ? requestedTodolistId : null,
                        sync_enabled: syncEnabled,
                        timesheet_enabled: updatedFields.basecamp_timesheet_enabled === true,
                    },
                });

                return json({ success: true });
            } catch {
                return json({ error: 'Unable to save Basecamp configuration' }, 500);
            }
        },
    };
}

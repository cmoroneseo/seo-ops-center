import { resolveSheetLinkPatch } from './sheet-link.ts';

export interface SheetConfig {
    roadmap_sheet_url: string | null;
    roadmap_sheet_id: string | null;
    sheet_mirror_enabled: boolean;
}

type Authorization =
    | { ok: true; clientId: string; organizationId: string; userId: string; actorName: string }
    | { ok: false; status: number; error: string };

type SheetActivityType = 'integration.connected' | 'integration.disconnected' | 'integration.reconfigured';

interface Dependencies {
    authorize(clientId: string): Promise<Authorization>;
    createStore(): {
        get(clientId: string, organizationId: string): Promise<SheetConfig | null>;
        update(clientId: string, organizationId: string, config: Partial<SheetConfig>): Promise<SheetConfig | null>;
    };
    logActivity(event: {
        clientId: string;
        organizationId: string;
        actorId: string;
        actorName: string;
        eventType: SheetActivityType;
        metadata: { service: 'google-sheets' };
    }): Promise<void>;
}

function errorResponse(error: string, status: number) {
    return Response.json({ error }, { status });
}

export function createSheetConfigHandlers({ authorize, createStore, logActivity }: Dependencies) {
    const recordActivity = (access: Extract<Authorization, { ok: true }>, eventType: SheetActivityType) =>
        logActivity({
            clientId: access.clientId,
            organizationId: access.organizationId,
            actorId: access.userId,
            actorName: access.actorName,
            eventType,
            metadata: { service: 'google-sheets' },
        }).catch(error => console.error('Unable to log Google Sheets activity', error));

    return {
        async get(clientId: string): Promise<Response> {
            try {
                const access = await authorize(clientId);
                if (!access.ok) return errorResponse(access.error, access.status);

                const config = await createStore().get(access.clientId, access.organizationId);
                return config ? Response.json(config) : errorResponse('Client not found', 404);
            } catch {
                return errorResponse('Unable to load Google Sheets configuration', 500);
            }
        },

        async post(request: Request, clientId: string): Promise<Response> {
            try {
                const access = await authorize(clientId);
                if (!access.ok) return errorResponse(access.error, access.status);

                const body = await request.json().catch(() => null);
                const url: unknown = body?.roadmap_sheet_url;
                if (typeof url !== 'string' && url !== null) {
                    return errorResponse('Provide a Google Sheets link or null to remove it.', 400);
                }
                const patch = resolveSheetLinkPatch(url ?? '');
                if (!patch.ok) return errorResponse(patch.error, 400);

                const store = createStore();
                const current = await store.get(access.clientId, access.organizationId);
                if (!current) return errorResponse('Client not found', 404);
                const config = await store.update(access.clientId, access.organizationId, {
                    roadmap_sheet_url: patch.roadmapSheetUrl,
                    roadmap_sheet_id: patch.roadmapSheetId,
                    ...(patch.roadmapSheetId === null ? { sheet_mirror_enabled: false } : {}),
                });
                if (!config) return errorResponse('Client not found', 404);

                let eventType: SheetActivityType = 'integration.reconfigured';
                if (!current.roadmap_sheet_id && config.roadmap_sheet_id) eventType = 'integration.connected';
                if (current.roadmap_sheet_id && !config.roadmap_sheet_id) eventType = 'integration.disconnected';
                await recordActivity(access, eventType);

                return Response.json(config);
            } catch {
                return errorResponse('Unable to save Google Sheets configuration', 500);
            }
        },

        async patch(request: Request, clientId: string): Promise<Response> {
            try {
                const access = await authorize(clientId);
                if (!access.ok) return errorResponse(access.error, access.status);

                const body = await request.json().catch(() => null);
                if (!body || typeof body !== 'object' || Array.isArray(body)
                    || Object.keys(body).length !== 1 || typeof body.enabled !== 'boolean') {
                    return errorResponse('Provide only an enabled boolean.', 400);
                }
                const enabled: boolean = body.enabled;

                const store = createStore();
                const current = await store.get(access.clientId, access.organizationId);
                if (!current) return errorResponse('Client not found', 404);
                const linkRequired = () => errorResponse('Link a Google Sheet in Integrations first', 409);
                if (enabled && !current.roadmap_sheet_id) return linkRequired();
                if (current.sheet_mirror_enabled === enabled) return Response.json(current);

                const config = await store.update(access.clientId, access.organizationId, { sheet_mirror_enabled: enabled });
                if (!config) return enabled ? linkRequired() : errorResponse('Client not found', 404);

                await recordActivity(access, 'integration.reconfigured');
                return Response.json(config);
            } catch {
                return errorResponse('Unable to save the sheet mirror setting', 500);
            }
        },
    };
}

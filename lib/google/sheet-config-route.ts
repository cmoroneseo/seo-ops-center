import { resolveSheetLinkPatch } from './sheet-link.ts';

export interface SheetConfig {
    roadmap_sheet_url: string | null;
    roadmap_sheet_id: string | null;
}

type Authorization =
    | { ok: true; clientId: string; organizationId: string; userId: string; actorName: string }
    | { ok: false; status: number; error: string };

type SheetActivityType = 'integration.connected' | 'integration.disconnected' | 'integration.reconfigured';

interface Dependencies {
    authorize(clientId: string): Promise<Authorization>;
    createStore(): {
        get(clientId: string, organizationId: string): Promise<SheetConfig | null>;
        update(clientId: string, organizationId: string, config: SheetConfig): Promise<SheetConfig | null>;
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
                });
                if (!config) return errorResponse('Client not found', 404);

                let eventType: SheetActivityType = 'integration.reconfigured';
                if (!current.roadmap_sheet_id && config.roadmap_sheet_id) eventType = 'integration.connected';
                if (current.roadmap_sheet_id && !config.roadmap_sheet_id) eventType = 'integration.disconnected';
                await logActivity({
                    clientId: access.clientId,
                    organizationId: access.organizationId,
                    actorId: access.userId,
                    actorName: access.actorName,
                    eventType,
                    metadata: { service: 'google-sheets' },
                }).catch(error => console.error('Unable to log Google Sheets activity', error));

                return Response.json(config);
            } catch {
                return errorResponse('Unable to save Google Sheets configuration', 500);
            }
        },
    };
}

type ClientAuthorization =
    | {
        ok: true;
        userId: string;
        actorName: string;
        organizationId: string;
        clientId: string;
        role: 'owner' | 'admin' | 'member' | 'viewer';
    }
    | { ok: false; status: number; error: string };

interface Dependencies {
    authorizeClient(clientId: unknown, organizationId: unknown): Promise<ClientAuthorization>;
    createReader(): {
        listImportedTodoIds(clientId: string, organizationId: string): Promise<number[]>;
    };
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

export function createBasecampImportedIdsGet(dependencies: Dependencies) {
    return async function getImportedIds(req: Request): Promise<Response> {
        try {
            const params = new URL(req.url).searchParams;
            const clientId = params.get('clientId');
            const organizationId = params.get('organizationId');
            if (!clientId || !organizationId) {
                return json({ error: 'clientId and organizationId are required' }, 400);
            }

            const authorization = await dependencies.authorizeClient(clientId, organizationId);
            if (!authorization.ok) {
                return json({ error: authorization.error }, authorization.status);
            }

            const ids = await dependencies.createReader().listImportedTodoIds(
                authorization.clientId,
                authorization.organizationId,
            );
            return json({ ids });
        } catch {
            return json({ error: 'Unable to load imported Basecamp IDs' }, 500);
        }
    };
}

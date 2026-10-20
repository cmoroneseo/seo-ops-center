import type { UrlResultsLoadInput, UrlResultsPayload } from './url-results-load';

type ClientAuth =
    | { ok: true; organizationId: string; clientId: string }
    | { ok: false; status: number; error: string };

export interface UrlResultsRouteDeps {
    authorize: (clientId: unknown) => Promise<ClientAuth>;
    load: (input: UrlResultsLoadInput) => Promise<UrlResultsPayload>;
    now: () => Date;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function createUrlResultsHandler(deps: UrlResultsRouteDeps) {
    return async function GET(request: Request) {
        const params = new URL(request.url).searchParams;
        const auth = await deps.authorize(params.get('clientId'));
        if (!auth.ok) return json({ error: auth.error }, auth.status);
        try {
            const loaded = await deps.load({
                organizationId: auth.organizationId,
                clientId: auth.clientId,
                now: deps.now(),
            });
            return json(loaded);
        } catch {
            return json({ error: 'Unable to read URL results' }, 500);
        }
    };
}

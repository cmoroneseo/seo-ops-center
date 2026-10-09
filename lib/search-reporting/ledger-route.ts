import { buildLedger, type LedgerSource } from './ledger';
import type { LedgerLoadInput } from './ledger-load';

type ClientAuth =
    | { ok: true; organizationId: string; clientId: string }
    | { ok: false; status: number; error: string };

export interface LedgerRouteDeps {
    authorize: (clientId: unknown) => Promise<ClientAuth>;
    enabled: () => boolean;
    load: (input: LedgerLoadInput) => Promise<LedgerSource>;
    now: () => Date;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function createLedgerHandler(deps: LedgerRouteDeps) {
    return async function GET(request: Request) {
        const params = new URL(request.url).searchParams;
        const auth = await deps.authorize(params.get('clientId'));
        if (!auth.ok) return json({ error: auth.error }, auth.status);
        if (!deps.enabled()) return json({ error: 'Not found' }, 404);
        try {
            const loaded = await deps.load({
                organizationId: auth.organizationId,
                clientId: auth.clientId,
                now: deps.now(),
                range: params.get('range'),
            });
            return json(buildLedger(loaded, deps.now()));
        } catch {
            return json({ error: 'Unable to read the results ledger' }, 500);
        }
    };
}

import type { requireClientOrgMember } from '../security/tenant-authz';
import { MIRROR_OFF, type syncClientSheet } from './run';

export async function runManualMirror(clientId: string, deps: {
    enabled: boolean;
    authorize: typeof requireClientOrgMember;
    sync: (clientId: string, organizationId: string, userId: string) => Promise<Awaited<ReturnType<typeof syncClientSheet>> | { status: 'unconfigured'; error: string }>;
}): Promise<Response> {
    const auth = await deps.authorize(clientId);
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
    if (!['owner', 'admin', 'member'].includes(auth.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!deps.enabled) return Response.json({ error: MIRROR_OFF, enabled: false }, { status: 409 });

    const result = await deps.sync(clientId, auth.organizationId, auth.userId);
    if (result.status === 'skipped') {
        switch (result.reason) {
            case 'rate_limited':
                return Response.json({ error: 'Wait two minutes between manual sheet syncs' }, { status: 429 });
            case 'missing_sheet':
                return Response.json({ error: 'Save a Client SEO sheet first' }, { status: 409 });
            case 'disabled':
                return Response.json({ error: MIRROR_OFF, enabled: false }, { status: 409 });
            default:
                return Response.json({ error: 'A sheet sync is already in progress' }, { status: 409 });
        }
    }
    if (result.status === 'unconfigured') return Response.json({ error: result.error }, { status: 503 });
    if (result.status === 'failed') return Response.json({ error: result.error }, { status: 502 });
    return Response.json(result);
}

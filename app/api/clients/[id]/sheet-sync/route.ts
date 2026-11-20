import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { handleManualMirror, isMirrorEnabled, liveMirrorStore } from '@/lib/sheets-mirror/live';
import { runManualMirror } from '@/lib/sheets-mirror/manual';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
    const { id } = await params;
    const auth = await requireClientOrgMember(id);
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
    const enabled = isMirrorEnabled();
    const canSync = auth.role === 'owner' || auth.role === 'admin' || auth.role === 'member';
    try {
        const store = liveMirrorStore();
        const [client, runs] = await Promise.all([
            store.loadClient(id, auth.organizationId),
            store.listRuns(id, auth.organizationId),
        ]);
        return Response.json({ runs, enabled, canSync, clientEnabled: client?.sheet_mirror_enabled ?? false });
    } catch {
        return Response.json({ error: 'Could not load recent sheet syncs', enabled, canSync }, { status: 500 });
    }
}

export async function POST(_request: Request, { params }: Context) {
    const { id } = await params;
    try {
        return await runManualMirror(id, {
            enabled: isMirrorEnabled(),
            authorize: requireClientOrgMember,
            loadClient: (clientId, organizationId) => liveMirrorStore().loadClient(clientId, organizationId),
            sync: handleManualMirror,
        });
    } catch {
        return Response.json({ error: 'Could not run the sheet mirror' }, { status: 500 });
    }
}

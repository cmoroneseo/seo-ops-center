import type { createAdminClient } from '@/lib/supabase/admin';

export async function runApprovalRetention(admin: ReturnType<typeof createAdminClient>) {
    const p_now = new Date().toISOString();
    const selected = await admin.rpc('purge_gbp_approval_retention', { p_now });
    if (selected.error || selected.data?.ok !== true) {
        return Response.json({ error: 'Retention could not run.' }, { status: 500 });
    }
    const keys = selected.data.objectKeys as string[];
    // Keep rows on Storage failure, so the next daily run can retry every key.
    for (let offset = 0; offset < keys.length; offset += 100) {
        const batch = keys.slice(offset, offset + 100);
        const removed = await admin.storage.from('gbp-approval-uploads').remove(batch);
        if (removed.error) return Response.json({ error: 'Photos could not be removed.' }, { status: 500 });
        const purged = await admin.rpc('purge_gbp_approval_retention', { p_now, p_removed_keys: batch });
        if (purged.error || purged.data?.ok !== true) {
            return Response.json({ error: 'Retention could not finish.' }, { status: 500 });
        }
    }
    return Response.json({ ok: true, objectsRemoved: keys.length });
}

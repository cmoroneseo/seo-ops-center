import { NextResponse } from 'next/server';
import { requirePortalAccess } from '@/lib/portal/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { portalToday } from '@/lib/portal/dashboard';

export async function POST() {
    const access = await requirePortalAccess();
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const { contact } = access.identity;
    const { error } = await createAdminClient().from('client_portal_visits').upsert({
        organization_id: contact.organizationId, client_id: contact.clientId, contact_id: contact.id,
        visited_on: portalToday(),
    }, { onConflict: 'contact_id,visited_on', ignoreDuplicates: true });
    return NextResponse.json({ ok: !error }, { status: error ? 500 : 200 });
}

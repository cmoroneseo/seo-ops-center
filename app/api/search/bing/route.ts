import { bingWebmasterEnabled } from '@/lib/bing/flags';
import { loadBingSearchPayload } from '@/lib/search-dashboard/bing-server';
import { inclusiveDays } from '@/lib/search-reporting/range';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { createAdminClient } from '@/lib/supabase/admin';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
    const params = new URL(req.url).searchParams;
    const auth = await requireClientOrgMember(params.get('clientId'), params.get('orgId'));
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
    if (!bingWebmasterEnabled(process.env, auth.organizationId)) {
        return Response.json({ enabled: false });
    }
    const start = params.get('start') ?? '';
    const end = params.get('end') ?? '';
    if (!ISO.test(start) || !ISO.test(end) || start > end) {
        return Response.json({ enabled: true, unavailable: true });
    }
    try {
        if (inclusiveDays(start, end) > 120) return Response.json({ enabled: true, unavailable: true });
    } catch {
        return Response.json({ enabled: true, unavailable: true });
    }
    try {
        const payload = await loadBingSearchPayload(createAdminClient(), auth.organizationId, auth.clientId, { start, end });
        return Response.json({ enabled: true, ...payload });
    } catch {
        return Response.json({ enabled: true, unavailable: true });
    }
}

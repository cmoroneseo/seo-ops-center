import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Clears IP hashes older than 12 months and upload reservations left unused for 24 hours. */
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const result = await createAdminClient().rpc('purge_gbp_approval_retention', {
        p_now: new Date().toISOString(),
    });
    if (result.error) return Response.json({ error: 'Retention could not run.' }, { status: 500 });
    return Response.json(result.data);
}

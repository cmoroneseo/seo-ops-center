import { createAdminClient } from '@/lib/supabase/admin';
import { runApprovalRetention } from '@/lib/gbp-approvals/retention';

export const dynamic = 'force-dynamic';

/** Clears old IP hashes and removes expired orphan photos before their reservations. */
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return runApprovalRetention(createAdminClient());
}

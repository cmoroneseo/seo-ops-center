import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { enqueueGscSync, runGscSyncWorker } from '@/lib/supabase/gsc-background';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (process.env.GSC_HISTORY_ENABLED !== 'true') return NextResponse.json({ skipped: true });
    try {
        const admin = createAdminClient();
        // Paginate the catalog; a large agency must not silently lose clients after row 1000.
        for (let offset = 0; ; offset += 500) {
            const { data, error } = await admin.from('client_integrations').select('client_id,organization_id')
                .eq('service', 'gsc').in('sync_status', ['active', 'error']).order('id').range(offset, offset + 499);
            if (error) throw new Error('Unable to load connections');
            for (const row of data ?? []) await enqueueGscSync(row.organization_id, row.client_id);
            if ((data?.length ?? 0) < 500) break;
        }
        return NextResponse.json(await runGscSyncWorker());
    } catch {
        return NextResponse.json({ error: 'Search performance sync will retry on the next run.' }, { status: 500 });
    }
}

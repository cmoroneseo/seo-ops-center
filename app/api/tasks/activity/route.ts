import { NextRequest, NextResponse } from 'next/server';
import { logClientActivity } from '@/lib/supabase/client-activity';

/**
 * POST /api/tasks/activity
 * Logs a task lifecycle event to the client activity feed.
 * Called fire-and-forget from the browser after task create/complete.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { organizationId, clientId, eventType, actorId, actorName, metadata } = body;

        if (!organizationId || !clientId || !eventType) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        await logClientActivity({ organizationId, clientId, eventType, actorId, actorName, metadata });
        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[tasks/activity] error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

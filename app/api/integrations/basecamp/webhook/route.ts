import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logClientActivity } from '@/lib/supabase/client-activity';

export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/basecamp/webhook?secret=BASECAMP_WEBHOOK_SECRET
 *
 * Receives Basecamp 3 webhook payloads. Currently handles:
 *   - todo_completion_created  → marks the linked SEO PM task as done
 *   - todo_completion_destroyed → reopens the linked SEO PM task
 *
 * Setup: In each Basecamp project → Settings → Webhooks → add:
 *   https://seo-ops-center.vercel.app/api/integrations/basecamp/webhook?secret=<BASECAMP_WEBHOOK_SECRET>
 */
export async function POST(req: NextRequest) {
    const secret = req.nextUrl.searchParams.get('secret');
    if (!secret || secret !== process.env.BASECAMP_WEBHOOK_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let payload: any;
    try {
        payload = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { kind, recording, creator } = payload;
    if (!recording?.id) {
        return NextResponse.json({ ok: true, skipped: 'no recording id' });
    }

    const admin = createAdminClient();

    // Look up the task by basecamp_todo_id
    const { data: task } = await admin
        .from('tasks')
        .select('id, status, status_history, organization_id, client_id, title')
        .eq('basecamp_todo_id', recording.id)
        .maybeSingle();

    if (!task) {
        return NextResponse.json({ ok: true, skipped: 'no linked task' });
    }

    const now = new Date().toISOString();
    const actorName = creator?.name ?? 'Basecamp';

    if (kind === 'todo_completion_created' && task.status !== 'done') {
        const history = Array.isArray(task.status_history) ? task.status_history : [];
        history.push({ status: 'done', at: now, by: actorName });

        await admin
            .from('tasks')
            .update({
                status: 'done',
                completed_at: now,
                status_history: history,
                last_synced_at: now,
            })
            .eq('id', task.id);

        if (task.client_id) {
            await logClientActivity({
                organizationId: task.organization_id,
                clientId: task.client_id,
                eventType: 'task.completed',
                actorName,
                metadata: { taskId: task.id, title: task.title, source: 'basecamp' },
            });
        }

        return NextResponse.json({ ok: true, action: 'completed', taskId: task.id });
    }

    if (kind === 'todo_completion_destroyed' && task.status === 'done') {
        const history = Array.isArray(task.status_history) ? task.status_history : [];
        history.push({ status: 'todo', at: now, by: actorName });

        await admin
            .from('tasks')
            .update({
                status: 'todo',
                completed_at: null,
                status_history: history,
                last_synced_at: now,
            })
            .eq('id', task.id);

        return NextResponse.json({ ok: true, action: 'reopened', taskId: task.id });
    }

    return NextResponse.json({ ok: true, skipped: kind });
}

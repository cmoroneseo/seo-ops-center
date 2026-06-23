import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logClientActivity } from '@/lib/supabase/client-activity';

export const dynamic = 'force-dynamic';

const COMPLETION_KINDS = new Set([
    'todo_completion_created',
    'todo_completed',
    'todo_changed',
]);

const REOPEN_KINDS = new Set([
    'todo_completion_destroyed',
    'todo_uncompleted',
]);

/**
 * POST /api/integrations/basecamp/webhook?secret=BASECAMP_WEBHOOK_SECRET
 *
 * Receives Basecamp 3 webhook payloads. Handles:
 *   - Todo completion → marks the linked SEO PM task as done
 *   - Todo uncomplete → reopens the linked SEO PM task
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
    console.log('[Basecamp webhook] kind:', kind, 'recording.id:', recording?.id, 'recording.type:', recording?.type);

    if (!recording?.id) {
        return NextResponse.json({ ok: true, skipped: 'no recording id' });
    }

    // For todo_changed, check if the todo was actually completed
    const isCompletion = COMPLETION_KINDS.has(kind) &&
        (kind !== 'todo_changed' || recording.completed === true);
    const isReopen = REOPEN_KINDS.has(kind) ||
        (kind === 'todo_changed' && recording.completed === false);

    if (!isCompletion && !isReopen) {
        console.log('[Basecamp webhook] skipping kind:', kind);
        return NextResponse.json({ ok: true, skipped: kind });
    }

    const admin = createAdminClient();

    // Look up the task by basecamp_todo_id
    const { data: task, error: lookupError } = await admin
        .from('tasks')
        .select('id, status, status_history, organization_id, client_id, title')
        .eq('basecamp_todo_id', recording.id)
        .maybeSingle();

    if (lookupError) {
        console.error('[Basecamp webhook] lookup error:', lookupError);
        return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
    }

    if (!task) {
        console.log('[Basecamp webhook] no linked task for basecamp_todo_id:', recording.id);
        return NextResponse.json({ ok: true, skipped: 'no linked task' });
    }

    const now = new Date().toISOString();
    const actorName = creator?.name ?? 'Basecamp';

    if (isCompletion && task.status !== 'done') {
        const history = Array.isArray(task.status_history) ? task.status_history : [];
        history.push({ status: 'done', at: now, by: actorName });

        const { error: updateError } = await admin
            .from('tasks')
            .update({
                status: 'done',
                completed_at: now,
                status_history: history,
                last_synced_at: now,
            })
            .eq('id', task.id);

        if (updateError) {
            console.error('[Basecamp webhook] update error:', updateError);
            return NextResponse.json({ error: 'Update failed' }, { status: 500 });
        }

        if (task.client_id) {
            await logClientActivity({
                organizationId: task.organization_id,
                clientId: task.client_id,
                eventType: 'task.completed',
                actorName,
                metadata: { taskId: task.id, title: task.title, source: 'basecamp' },
            });
        }

        console.log('[Basecamp webhook] completed task:', task.id, task.title);
        return NextResponse.json({ ok: true, action: 'completed', taskId: task.id });
    }

    if (isReopen && task.status === 'done') {
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

        console.log('[Basecamp webhook] reopened task:', task.id, task.title);
        return NextResponse.json({ ok: true, action: 'reopened', taskId: task.id });
    }

    return NextResponse.json({ ok: true, skipped: 'no status change needed' });
}

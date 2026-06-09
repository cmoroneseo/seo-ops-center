import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';
import { cookies } from 'next/headers';
import {
    isBasecampConfigured,
    createBasecampTodo,
    completeBasecampTodo,
    reopenBasecampTodo,
    createBasecampComment,
} from '@/lib/basecamp/api';

export const dynamic = 'force-dynamic';

async function getUser() {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) { return cookieStore.get(name)?.value; },
                set(name: string, value: string, options: CookieOptions) { cookieStore.set({ name, value, ...options }); },
                remove(name: string, options: CookieOptions) { cookieStore.set({ name, value: '', ...options }); },
            },
        },
    );
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

/**
 * POST /api/integrations/basecamp/push
 * Server-side Basecamp push handler. Called from the browser after task operations.
 *
 * Body variants:
 *   { action: 'create_todo', taskId, projectId, todolistId, content, dueOn?, description? }
 *   { action: 'complete_todo', taskId, projectId, todoId }
 *   { action: 'reopen_todo', taskId, projectId, todoId }
 *   { action: 'create_comment', taskId, projectId, todoId, content }
 */
export async function POST(req: NextRequest) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!isBasecampConfigured()) {
        return NextResponse.json({ error: 'Basecamp not configured', configured: false }, { status: 503 });
    }

    const body = await req.json();
    const { action, taskId } = body;
    const admin = createAdminClient();

    try {
        switch (action) {
            case 'create_todo': {
                const { projectId, todolistId, content, dueOn, description } = body;
                const result = await createBasecampTodo(projectId, todolistId, { content, dueOn, description });
                if (result) {
                    // Store basecamp_todo_id and basecamp_project_id on the task row
                    await admin
                        .from('tasks')
                        .update({
                            basecamp_todo_id: result.id,
                            basecamp_project_id: projectId,
                            last_synced_at: new Date().toISOString(),
                        })
                        .eq('id', taskId);
                }
                return NextResponse.json({ success: !!result, todoId: result?.id });
            }

            case 'complete_todo': {
                const { projectId, todoId } = body;
                const ok = await completeBasecampTodo(projectId, todoId);
                if (ok) {
                    await admin
                        .from('tasks')
                        .update({ last_synced_at: new Date().toISOString() })
                        .eq('id', taskId);
                }
                return NextResponse.json({ success: ok });
            }

            case 'reopen_todo': {
                const { projectId, todoId } = body;
                const ok = await reopenBasecampTodo(projectId, todoId);
                return NextResponse.json({ success: ok });
            }

            case 'create_comment': {
                const { projectId, todoId, content } = body;
                const commentId = await createBasecampComment(projectId, todoId, content);
                return NextResponse.json({ success: !!commentId, commentId });
            }

            default:
                return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[Basecamp push] error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

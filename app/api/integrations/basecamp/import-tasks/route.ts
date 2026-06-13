import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';
import { logClientActivity } from '@/lib/supabase/client-activity';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

interface ImportTaskPayload {
    title: string;
    description?: string;
    dueOn?: string;
    basecampTodoId: number;
    basecampProjectId: number;
    category?: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
}

interface ImportBody {
    clientId: string;
    organizationId: string;
    tasks: ImportTaskPayload[];
}

function chunk<T>(arr: T[], size = 500): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

/**
 * POST /api/integrations/basecamp/import-tasks
 * Bulk-creates SEO PM tasks from selected Basecamp todos.
 */
export async function POST(req: NextRequest) {
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
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as ImportBody;
    const { clientId, organizationId, tasks } = body;

    if (!clientId || !organizationId || !Array.isArray(tasks) || tasks.length === 0) {
        return NextResponse.json({ error: 'clientId, organizationId, and tasks[] are required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const now = new Date().toISOString();
    const actorName = user.user_metadata?.full_name || user.email || undefined;

    const rows = tasks.map(t => ({
        organization_id: organizationId,
        client_id: clientId,
        title: t.title,
        description: t.description || null,
        due_date: t.dueOn || null,
        priority: t.priority ?? 'medium',
        status: 'todo',
        category: t.category || null,
        tags: [],
        assignee_ids: [],
        sort_order: 0,
        basecamp_todo_id: t.basecampTodoId,
        basecamp_project_id: t.basecampProjectId,
        last_synced_at: now,
        status_history: [{ status: 'todo', at: now, by: user.id }],
        custom_fields: {},
        watcher_ids: [],
        created_by: user.id,
    }));

    const errors: string[] = [];
    let imported = 0;

    for (const part of chunk(rows)) {
        const { error } = await admin.from('tasks').insert(part);
        if (error) {
            errors.push(error.message);
        } else {
            imported += part.length;
        }
    }

    if (imported > 0) {
        await logClientActivity({
            organizationId,
            clientId,
            eventType: 'integration.tasks_imported',
            actorId: user.id,
            actorName,
            metadata: { service: 'basecamp', imported, errors: errors.length },
        });
    }

    return NextResponse.json({ imported, errors });
}

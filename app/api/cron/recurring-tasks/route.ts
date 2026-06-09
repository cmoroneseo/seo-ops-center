import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getNextDueDate } from '@/lib/utils/recurrence';

export const maxDuration = 300;

/**
 * POST /api/cron/recurring-tasks
 *
 * Triggered daily at 9am UTC (3am CT) by Vercel Cron.
 * Safety net: finds recurring tasks that are done but have no future successor,
 * and spawns the next instance.
 *
 * Also triggered manually from UI with same auth pattern.
 * Headers: { Authorization: 'Bearer <CRON_SECRET>' }
 */

async function isAuthorized(req: NextRequest): Promise<boolean> {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true;

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
    return !!user;
}

export async function POST(req: NextRequest) {
    if (!(await isAuthorized(req))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const results = { orgsProcessed: 0, tasksChecked: 0, tasksSpawned: 0, errors: 0 };

    try {
        // Fetch all orgs
        const { data: orgs, error: orgsErr } = await admin
            .from('organizations')
            .select('id')
            .order('id');
        if (orgsErr) throw orgsErr;

        for (const org of orgs ?? []) {
            results.orgsProcessed++;

            // Find done tasks with recurrence that have no future successor task
            // (parent_task_id points to the completed task for child instances)
            const { data: doneTasks, error: tasksErr } = await admin
                .from('tasks')
                .select('id, title, description, priority, category, tags, estimated_hours, assignee_ids, due_date, client_id, project_id, organization_id, template_id, recurrence')
                .eq('organization_id', org.id)
                .eq('status', 'done')
                .not('recurrence', 'is', null);

            if (tasksErr) {
                console.error(`Error fetching tasks for org ${org.id}:`, tasksErr);
                results.errors++;
                continue;
            }

            for (const task of doneTasks ?? []) {
                results.tasksChecked++;

                // Check if a future successor already exists
                const { count } = await admin
                    .from('tasks')
                    .select('id', { count: 'exact', head: true })
                    .eq('parent_task_id', task.id)
                    .neq('status', 'done');

                if ((count ?? 0) > 0) continue; // already has a live successor

                // Calculate next due date
                const nextDue = getNextDueDate(
                    task.recurrence,
                    task.due_date ?? new Date().toISOString().slice(0, 10),
                );
                if (!nextDue) continue; // past end date

                // Spawn next instance
                const { error: insertErr } = await admin
                    .from('tasks')
                    .insert([{
                        organization_id: task.organization_id,
                        project_id: task.project_id,
                        client_id: task.client_id,
                        title: task.title,
                        description: task.description,
                        priority: task.priority ?? 'medium',
                        category: task.category,
                        tags: task.tags ?? [],
                        estimated_hours: task.estimated_hours,
                        assignee_ids: task.assignee_ids ?? [],
                        due_date: nextDue,
                        status: 'todo',
                        template_id: task.template_id,
                        recurrence: task.recurrence,
                        parent_task_id: task.id,
                        status_history: [{ status: 'todo', at: new Date().toISOString() }],
                    }]);

                if (insertErr) {
                    console.error(`Error spawning recurring task from ${task.id}:`, insertErr);
                    results.errors++;
                } else {
                    results.tasksSpawned++;
                }
            }
        }
    } catch (err) {
        console.error('Recurring tasks cron error:', err);
        return NextResponse.json({ error: 'Internal error', results }, { status: 500 });
    }

    return NextResponse.json({ success: true, results });
}

// Support GET for manual trigger from browser (authenticated)
export const GET = POST;

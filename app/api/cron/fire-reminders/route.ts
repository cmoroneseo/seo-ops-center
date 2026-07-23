import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { notifyAtMs } from '@/lib/reminders-logic';

export const maxDuration = 60;

/**
 * GET|POST /api/cron/fire-reminders
 *
 * Every 5 minutes (Vercel Cron). Finds pending personal reminders whose
 * notify time (due_at minus notify_offset_minutes) has arrived and creates
 * a 'reminder_due' bell notification for the owner. Stamps notified_at so
 * a reminder never fires twice. Recurrence is handled at completion time
 * (completeReminder), not here.
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
    const results = { checked: 0, fired: 0, errors: 0 };
    const now = Date.now();

    try {
        // Candidates: pending, never notified, notification enabled, and due
        // within the next 24h or already past. The precise offset check
        // happens in TS via notifyAtMs.
        const horizon = new Date(now + 24 * 60 * 60 * 1000).toISOString();
        const { data: reminders, error } = await admin
            .from('personal_reminders')
            .select('id, organization_id, user_id, title, notes, due_at, notify_offset_minutes, client_id')
            .eq('status', 'pending')
            .is('notified_at', null)
            .not('notify_offset_minutes', 'is', null)
            .lte('due_at', horizon);
        if (error) throw error;

        for (const r of reminders ?? []) {
            results.checked++;
            const fireAt = notifyAtMs(r.due_at, r.notify_offset_minutes);
            if (fireAt === null || fireAt > now) continue;

            const { error: notifErr } = await admin.from('notifications').insert({
                organization_id: r.organization_id,
                user_id: r.user_id,
                type: 'reminder_due',
                title: `Reminder: ${r.title}`,
                body: r.notes ?? null,
                entity_type: 'reminder',
                entity_id: r.id,
                client_id: r.client_id ?? null,
            });
            if (notifErr) {
                console.error(`[fire-reminders] notify error for ${r.id}:`, notifErr);
                results.errors++;
                continue;
            }

            const { error: stampErr } = await admin
                .from('personal_reminders')
                .update({ notified_at: new Date(now).toISOString() })
                .eq('id', r.id);
            if (stampErr) {
                console.error(`[fire-reminders] stamp error for ${r.id}:`, stampErr);
                results.errors++;
            } else {
                results.fired++;
            }
        }
    } catch (err) {
        console.error('[fire-reminders] cron error:', err);
        return NextResponse.json({ error: 'Internal error', results }, { status: 500 });
    }

    return NextResponse.json({ success: true, results });
}

export const GET = POST;

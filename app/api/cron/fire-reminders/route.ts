import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { notifyAtMs } from '@/lib/reminders-logic';

export const maxDuration = 60;

/**
 * GET|POST /api/cron/fire-reminders
 *
 * Daily at 6am UTC (Vercel Cron — Hobby plan caps cron frequency at once/day;
 * bump to a Pro plan + tighter schedule for closer-to-on-time delivery).
 * Finds pending personal reminders whose notify time (due_at minus
 * notify_offset_minutes) has arrived and creates a 'reminder_due' bell
 * notification for the owner. Claims each row with a conditional update
 * (still notified_at IS NULL) before notifying, so a reminder never fires
 * twice even under overlapping/retried invocations. Recurrence is handled
 * at completion time (completeReminder), not here.
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
        // Candidates: pending, never notified, notification enabled. No
        // due_at horizon filter — notify_offset_minutes is unbounded (e.g.
        // "2 days before"), so a due_at-based cutoff can exclude a row whose
        // notify time has already arrived even though due_at itself is far
        // out. Personal reminder volume per org is small, so a full scan of
        // eligible rows is cheap. The precise offset check happens in TS.
        const { data: reminders, error } = await admin
            .from('personal_reminders')
            .select('id, organization_id, user_id, title, notes, due_at, notify_offset_minutes, client_id')
            .eq('status', 'pending')
            .is('notified_at', null)
            .not('notify_offset_minutes', 'is', null);
        if (error) throw error;

        for (const r of reminders ?? []) {
            results.checked++;
            const fireAt = notifyAtMs(r.due_at, r.notify_offset_minutes);
            if (fireAt === null || fireAt > now) continue;

            // Claim the row before notifying: an atomic conditional update
            // (still notified_at IS NULL) means a slow/duplicate cron
            // invocation can't double-fire. If the notification insert
            // then fails, we accept a missed notification over a duplicate
            // one — the constraint is "never twice," not "always exactly
            // once."
            const { data: claimed, error: claimErr } = await admin
                .from('personal_reminders')
                .update({ notified_at: new Date(now).toISOString() })
                .eq('id', r.id)
                .is('notified_at', null)
                .select('id');
            if (claimErr) {
                console.error(`[fire-reminders] claim error for ${r.id}:`, claimErr);
                results.errors++;
                continue;
            }
            if (!claimed || claimed.length === 0) continue; // already claimed by another run

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

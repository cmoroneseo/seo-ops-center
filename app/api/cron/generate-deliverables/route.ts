import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { proratedQuantity } from '@/lib/seo-ops-logic';

export const maxDuration = 300;

/**
 * POST /api/cron/generate-deliverables
 *
 * Triggered daily at 7am UTC by Vercel Cron (daily schedule, monthly
 * semantics): for every active commitment, ensure the current month has the
 * promised number of deliverable rows. Idempotent — inserts only the
 * shortfall, so daily re-runs and mid-month commitment changes are free.
 * Never deletes rows when a quantity decreases.
 *
 * Also emits overdue / at-risk notifications for the month's deliverables.
 *
 * Manually triggerable from the UI with the same auth pattern.
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

/** Last business day of a 'YYYY-MM' month (Sat/Sun roll back to Friday). */
function lastBusinessDay(month: string): string {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m, 0);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
}

function dueDateFor(month: string, dueDay?: number | null): string {
    if (!dueDay) return lastBusinessDay(month);
    return `${month}-${String(dueDay).padStart(2, '0')}`;
}

const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

function monthLabel(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return `${MONTH_LABELS[m - 1]} ${y}`;
}

export async function POST(req: NextRequest) {
    if (!(await isAuthorized(req))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const month = new Date().toISOString().slice(0, 7); // current 'YYYY-MM'
    const today = new Date().toISOString().slice(0, 10);
    const results = {
        orgsProcessed: 0, commitmentsChecked: 0, deliverablesCreated: 0,
        overdueNotified: 0, errors: 0,
    };

    try {
        const { data: orgs, error: orgsErr } = await admin
            .from('organizations')
            .select('id')
            .order('id');
        if (orgsErr) throw orgsErr;

        for (const org of orgs ?? []) {
            results.orgsProcessed++;

            // Active commitments overlapping the current month, with client status
            const { data: commitments, error: cErr } = await admin
                .from('deliverable_commitments')
                .select('*, clients!inner(id, status)')
                .eq('organization_id', org.id)
                .eq('is_active', true)
                .lte('starts_on', `${month}-31`)
                .or(`ends_on.is.null,ends_on.gte.${month}-01`);

            if (cErr) {
                console.error(`Error fetching commitments for org ${org.id}:`, cErr);
                results.errors++;
                continue;
            }

            for (const c of commitments ?? []) {
                results.commitmentsChecked++;

                // Skip clients that aren't active
                if (c.clients?.status && c.clients.status !== 'active') continue;
                // Quarterly/one-time cadences are Phase 2 — only monthly generates here
                if (c.cadence !== 'monthly') continue;

                let expected = proratedQuantity(
                    { quantityPerMonth: Number(c.quantity_per_month ?? 0), startsOn: c.starts_on, endsOn: c.ends_on },
                    month,
                );

                // Campaign: cap by remaining total across all generated rows
                if (c.engagement_model === 'Campaign' && c.total_quantity != null) {
                    const { count: allGenerated } = await admin
                        .from('deliverables')
                        .select('id', { count: 'exact', head: true })
                        .eq('commitment_id', c.id);
                    expected = Math.min(expected, Math.max(0, c.total_quantity - (allGenerated ?? 0)));
                }

                if (expected <= 0) continue;

                // Idempotency: only insert the shortfall for this month
                const { count: existing } = await admin
                    .from('deliverables')
                    .select('id', { count: 'exact', head: true })
                    .eq('commitment_id', c.id)
                    .eq('month', month);

                const shortfall = expected - (existing ?? 0);
                if (shortfall <= 0) continue;

                const dueDate = dueDateFor(month, c.due_day);
                const rows = Array.from({ length: shortfall }, (_, i) => ({
                    organization_id: c.organization_id,
                    client_id: c.client_id,
                    commitment_id: c.id,
                    title: `${c.title} ${(existing ?? 0) + i + 1} of ${expected} — ${monthLabel(month)}`,
                    type: c.type,
                    subtype: c.subtype,
                    status: 'Pending',
                    due_date: dueDate,
                    month,
                    assignee_id: c.default_assignee_id,
                    counts_toward_hours: c.counts_toward_hours ?? true,
                    generated_by: 'cron',
                    sequence_in_month: (existing ?? 0) + i + 1,
                    status_history: [{ status: 'Pending', at: new Date().toISOString() }],
                }));

                const { error: insertErr } = await admin.from('deliverables').insert(rows);
                if (insertErr) {
                    console.error(`Error generating deliverables for commitment ${c.id}:`, insertErr);
                    results.errors++;
                } else {
                    results.deliverablesCreated += rows.length;
                }
            }

            // Overdue notifications: past-due, undelivered deliverables this month
            const { data: overdue, error: oErr } = await admin
                .from('deliverables')
                .select('id, title, client_id, assignee_id, account_manager_id, due_date')
                .eq('organization_id', org.id)
                .eq('month', month)
                .lt('due_date', today)
                .in('status', ['Pending', 'In Progress', 'Review']);

            if (oErr) {
                console.error(`Error fetching overdue deliverables for org ${org.id}:`, oErr);
                results.errors++;
                continue;
            }

            for (const d of overdue ?? []) {
                const recipients = [...new Set([d.assignee_id, d.account_manager_id].filter(Boolean))];
                for (const userId of recipients) {
                    // Dedupe: skip if an unread overdue notification already exists
                    const { count: dupes } = await admin
                        .from('notifications')
                        .select('id', { count: 'exact', head: true })
                        .eq('user_id', userId)
                        .eq('type', 'deliverable_overdue')
                        .eq('entity_id', d.id)
                        .eq('is_read', false);
                    if ((dupes ?? 0) > 0) continue;

                    const { error: nErr } = await admin.from('notifications').insert([{
                        organization_id: org.id,
                        user_id: userId,
                        type: 'deliverable_overdue',
                        title: 'Deliverable overdue',
                        body: `${d.title} was due ${d.due_date}`,
                        entity_type: 'deliverable',
                        entity_id: d.id,
                        client_id: d.client_id,
                    }]);
                    if (nErr) {
                        console.error(`Error notifying overdue deliverable ${d.id}:`, nErr);
                        results.errors++;
                    } else {
                        results.overdueNotified++;
                    }
                }
            }
        }
    } catch (err) {
        console.error('Generate deliverables cron error:', err);
        return NextResponse.json({ error: 'Internal error', results }, { status: 500 });
    }

    return NextResponse.json({ success: true, month, results });
}

// Support GET for manual trigger from browser (authenticated)
export const GET = POST;

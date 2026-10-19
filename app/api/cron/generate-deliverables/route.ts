import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {requireOrganizationMember} from '@/lib/security/tenant-authz';
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

/** Last business day of a 'YYYY-MM' month (Sat/Sun roll back to Friday). */
function lastBusinessDay(month: string): string {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m, 0));
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

function dueDateFor(month: string, dueDay?: number | null): string {
    if (!dueDay) return lastBusinessDay(month);
    const last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();
    return `${month}-${String(Math.min(dueDay,last)).padStart(2, '0')}`;
}

const PAGE = 1000;
const COMMITMENT_COLUMNS = 'id, organization_id, client_id, title, cadence, quantity_per_month, starts_on, ends_on, due_day, engagement_model, total_quantity, type, subtype, counts_toward_hours, default_assignee_id, is_active, clients!inner(id, status)';

async function readAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>): Promise<{ rows: T[]; error: { code?: string; message?: string } | null }> {
    const rows: T[] = [];
    for (let from = 0; from < 50000; from += PAGE) {
        const page = await query(from, from + PAGE - 1);
        if (page.error) return { rows: [], error: page.error };
        const data = page.data ?? [];
        rows.push(...data);
        if (data.length < PAGE) return { rows, error: null };
    }
    return { rows: [], error: { code: 'limit', message: 'Too many rows' } };
}

const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

function monthLabel(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return `${MONTH_LABELS[m - 1]} ${y}`;
}

export async function POST(req: NextRequest) {
    const isCron=!!process.env.CRON_SECRET && req.headers.get('authorization')===`Bearer ${process.env.CRON_SECRET}`;
    let organizationId:string|null=null;
    if(!isCron) {
        const body=req.method==='GET' ? {organizationId:req.nextUrl.searchParams.get('organizationId')} : await req.json().catch(()=>null);
        const member=await requireOrganizationMember(body?.organizationId);
        if(!member.ok)return NextResponse.json({error:member.error},{status:member.status});
        if(member.role==='viewer')return NextResponse.json({error:'Read-only members cannot generate work.'},{status:403});
        organizationId=member.organizationId;
    }

    const admin = createAdminClient();
    const month = new Date().toISOString().slice(0, 7); // current 'YYYY-MM'
    const today = new Date().toISOString().slice(0, 10);
    const results = {
        orgsProcessed: 0, commitmentsChecked: 0, deliverablesCreated: 0,
        overdueNotified: 0, errors: 0,
    };

    try {
        let orgQuery = admin
            .from('organizations')
            .select('id')
            .order('id');
        if(organizationId)orgQuery=orgQuery.eq('id',organizationId);
        const {data:orgs,error:orgsErr}=await orgQuery;
        if (orgsErr) throw orgsErr;

        for (const org of orgs ?? []) {
            results.orgsProcessed++;

            // Active commitments overlapping the current month, with client status
            type CommitmentRow = {
                id: string; organization_id: string; client_id: string; title: string;
                cadence: string; quantity_per_month: number | null; starts_on: string; ends_on: string | null; due_day: number | null;
                engagement_model: string; total_quantity: number | null; type: string; subtype: string | null;
                counts_toward_hours: boolean | null; default_assignee_id: string | null;
                is_active: boolean; clients?: { id?: string; status?: string } | null;
            };
            const commitmentPage = await readAll<CommitmentRow>(async (from, to) => {
                const page = await admin
                    .from('deliverable_commitments')
                    .select(COMMITMENT_COLUMNS)
                    .eq('organization_id', org.id)
                    .eq('is_active', true)
                    .order('id')
                    .range(from, to);
                const rows = (page.data ?? []).map(row => ({ ...row, clients: Array.isArray(row.clients) ? row.clients[0] ?? null : row.clients })) as CommitmentRow[];
                return { data: rows, error: page.error ? { code: page.error.code, message: page.error.message } : null };
            });

            if (commitmentPage.error) {
                console.error(`Error fetching commitments for org ${org.id}:`, commitmentPage.error);
                results.errors++;
                continue;
            }
            const commitments = commitmentPage.rows;

            for (const c of commitments ?? []) {
                results.commitmentsChecked++;

                // Skip clients that aren't active
                if (c.clients?.status && c.clients.status !== 'active') continue;
                if (/^SEO Hours$/i.test(c.title)) continue;
                if (c.cadence !== 'monthly') continue;
                const startsOn = c.starts_on;
                const endsOn = c.ends_on;
                const workEnd = `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()}`;
                if (startsOn > workEnd || (endsOn && endsOn < `${month}-01`)) continue;

                let expected = proratedQuantity(
                    { quantityPerMonth: Number(c.quantity_per_month ?? 0), startsOn, endsOn },
                    month,
                );

                const { data: existingRows, error: existingError } = await admin.from('deliverables').select('id').eq('commitment_id', c.id).eq('month', month);
                if (existingError) throw existingError;
                const existing = existingRows?.length ?? 0;

                // Campaign: cap by remaining total across all generated rows
                if (c.engagement_model === 'Campaign' && c.total_quantity != null) {
                    const { count: allGenerated, error: generatedError } = await admin
                        .from('deliverables')
                        .select('id', { count: 'exact', head: true })
                        .eq('commitment_id', c.id);
                    if (generatedError) throw generatedError;
                    expected = Math.min(expected, existing + Math.max(0, c.total_quantity - (allGenerated ?? 0)));
                }

                if (expected <= 0) continue;

                // Idempotency: only insert the shortfall for this month
                const shortfall = expected - existing;
                if (shortfall <= 0) continue;

                const plannedDue = dueDateFor(month, c.due_day);
                const dueDate = endsOn && endsOn < plannedDue ? endsOn : plannedDue;
                const rows = Array.from({ length: shortfall }, (_, i) => ({
                    organization_id: c.organization_id,
                    client_id: c.client_id,
                    commitment_id: c.id,
                    title: `${c.title} ${existing + i + 1} of ${expected} — ${monthLabel(month)}`,
                    type: c.type,
                    subtype: c.subtype,
                    status: 'Pending',
                    due_date: dueDate,
                    month,
                    assignee_id: c.default_assignee_id,
                    counts_toward_hours: c.counts_toward_hours ?? true,
                    generated_by: 'cron',
                    sequence_in_month: existing + i + 1,
                    status_history: [{ status: 'Pending', at: new Date().toISOString() }],
                }));

                const { data: inserted, error: insertErr } = await admin.from('deliverables').insert(rows).select('id');
                if (insertErr) {
                    console.error(`Error generating deliverables for commitment ${c.id}:`, insertErr);
                    results.errors++;
                } else {
                    results.deliverablesCreated += inserted?.length ?? 0;
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

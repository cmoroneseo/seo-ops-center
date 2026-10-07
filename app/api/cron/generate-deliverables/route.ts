import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {requireOrganizationMember} from '@/lib/security/tenant-authz';
import { proratedQuantity } from '@/lib/seo-ops-logic';
import {rowToAgreement} from '@/lib/supabase/agreements';
import {agreementToday} from '@/lib/agreements/logic';
import {commitmentWindow,customOutputQuantity} from '@/lib/agreements/commitments';
import {rowToCommitment} from '@/lib/supabase/commitments';

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
            const {data:agreementRows,error:agreementError}=await admin.from('client_agreements').select('*').eq('organization_id',org.id);
            if(agreementError && !['42P01','PGRST205'].includes(agreementError.code))throw agreementError;
            const agreements=(agreementRows ?? []).map(rowToAgreement);

            // Active commitments overlapping the current month, with client status
            const { data: commitments, error: cErr } = await admin
                .from('deliverable_commitments')
                .select('*, clients!inner(id, status)')
                .eq('organization_id', org.id)
                .eq('is_active', true);

            if (cErr) {
                console.error(`Error fetching commitments for org ${org.id}:`, cErr);
                results.errors++;
                continue;
            }

            for (const c of commitments ?? []) {
                results.commitmentsChecked++;

                // Skip clients that aren't active
                if (c.clients?.status && c.clients.status !== 'active') continue;
                if(/^SEO Hours$/i.test(c.title))continue;
                const agreement=c.agreement_id ? agreements.find(a=>a.id===c.agreement_id) : null;
                if(c.agreement_id && (!agreement || agreement.cancelledAt))continue;
                const agreementDay=agreement ? agreementToday(agreement.timezone) : today;
                const workMonth=agreementDay.slice(0,7);
                const workEnd=`${workMonth}-${new Date(Date.UTC(Number(workMonth.slice(0,4)),Number(workMonth.slice(5)),0)).getUTCDate()}`;
                if(agreement && agreement.startsOn>agreementDay)continue;
                const window=commitmentWindow(rowToCommitment(c),agreements);
                if(!window)continue;
                const {startsOn,endsOn}=window;
                if(startsOn>workEnd || endsOn && endsOn<`${workMonth}-01`)continue;
                if(c.cadence!=='monthly' && !(c.cadence==='one_time' && agreement))continue;

                let expected = proratedQuantity(
                    { quantityPerMonth: Number(c.quantity_per_month ?? 0), startsOn, endsOn },
                    workMonth,
                );
                if(c.cadence==='one_time') {
                    if(agreement?.endsOn && endsOn && endsOn<agreement.endsOn)continue;
                    const root=c.custom_fields?.agreementOutputRoot;
                    const otherIds=(commitments ?? []).filter(other=>other.id!==c.id && other.client_id===c.client_id && (other.id===root || other.custom_fields?.agreementOutputRoot===root)).map(other=>other.id);
                    let issuedElsewhere=0;
                    if(root && otherIds.length) {
                        const {count,error}=await admin.from('deliverables').select('id',{count:'exact',head:true}).eq('organization_id',org.id).in('commitment_id',otherIds);
                        if(error)throw error;
                        issuedElsewhere=count ?? 0;
                    }
                    expected=customOutputQuantity(rowToCommitment(c),issuedElsewhere);
                }

                const targetMonth=c.cadence==='one_time' ? (agreement?.endsOn ?? startsOn).slice(0,7) : workMonth;

                const {data:existingRows,error:existingError}=await admin.from('deliverables').select('id,sequence_in_month').eq('commitment_id',c.id).eq('month',targetMonth);
                if(existingError)throw existingError;
                const existing=existingRows?.length ?? 0;

                // Campaign: cap by remaining total across all generated rows
                if (c.cadence==='monthly' && c.engagement_model === 'Campaign' && c.total_quantity != null) {
                    const { count: allGenerated,error:generatedError } = await admin
                        .from('deliverables')
                        .select('id', { count: 'exact', head: true })
                        .eq('commitment_id', c.id);
                    if(generatedError)throw generatedError;
                    expected = Math.min(expected, existing+Math.max(0, c.total_quantity - (allGenerated ?? 0)));
                }

                if (expected <= 0) continue;

                // Idempotency: only insert the shortfall for this month
                const shortfall = expected - existing;
                if (shortfall <= 0) continue;

                const plannedDue=c.cadence==='one_time' ? agreement?.endsOn ?? startsOn : dueDateFor(workMonth,c.due_day);
                const dueDate=endsOn && endsOn<plannedDue ? endsOn : plannedDue;
                const used=new Set((existingRows ?? []).map(row=>Number(row.sequence_in_month)));
                let sequence=0;
                const rows = Array.from({ length: shortfall }, (_, i) => ({
                    organization_id: c.organization_id,
                    client_id: c.client_id,
                    commitment_id: c.id,
                    ...(agreement ? {agreement_id:agreement.id} : {}),
                    ...(!agreementError ? {generation_key:`${c.id}:${targetMonth}:${(()=>{do {sequence++;}while(used.has(sequence));return sequence;})()}`} : {}),
                    title: `${c.title} ${existing + i + 1} of ${expected} — ${monthLabel(targetMonth)}`,
                    type: c.type,
                    subtype: c.subtype,
                    status: 'Pending',
                    due_date: dueDate,
                    month:targetMonth,
                    assignee_id: c.default_assignee_id,
                    counts_toward_hours: c.counts_toward_hours ?? true,
                    generated_by: 'cron',
                    sequence_in_month: !agreementError ? sequence : existing+i+1,
                    status_history: [{ status: 'Pending', at: new Date().toISOString() }],
                }));

                const write=agreementError ? admin.from('deliverables').insert(rows) : admin.from('deliverables').upsert(rows,{onConflict:'generation_key',ignoreDuplicates:true});
                const { data:inserted,error: insertErr } = await write.select('id');
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

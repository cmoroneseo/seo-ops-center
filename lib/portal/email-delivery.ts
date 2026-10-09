import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase/admin';
import { deliverQueuedReportSend } from '@/lib/reports/report-sends';
import { sendWindowOpen } from '@/lib/reports/schedule';
import { safePortalNext } from './access-policy';

const SUBJECTS: Record<string, string> = {
    plan: 'Your SEO Plan is ready to review', report: 'A new report is ready',
    reply: 'Your account team replied', update: 'Your campaign has a new update', request: 'Your team needs your input',
};

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

/** The queue stores references, not email addresses, messages, or magic tokens. */
export async function deliverPortalEmails(limit = 10) {
    const apiKey = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) return { sent: 0, failed: 0, canceled: 0, configured: false };
    const admin = createAdminClient();
    const { data: jobs, error } = await admin.rpc('claim_client_portal_emails', { p_limit: limit });
    if (error) throw new Error('Could not claim portal notification emails');
    const result = { sent: 0, failed: 0, canceled: 0, configured: true };
    const resend = new Resend(apiKey);
    for (const job of jobs ?? []) {
        const [contactResult, clientResult, orgResult] = await Promise.all([
            admin.from('client_portal_contacts').select('email').eq('id', job.contact_id)
                .eq('client_id', job.client_id).eq('organization_id', job.organization_id).is('revoked_at', null).maybeSingle(),
            admin.from('clients').select('name').eq('id', job.client_id).eq('organization_id', job.organization_id).maybeSingle(),
            admin.from('organizations').select('name').eq('id', job.organization_id).maybeSingle(),
        ]);
        try {
            if (job.event_kind === 'report_send') {
                if (!sendWindowOpen(new Date())) {
                    await admin.from('client_portal_email_queue').update({
                        claimed_at: null,
                        attempts: Math.max(0, Number(job.attempts) - 1),
                    }).eq('id', job.id);
                    continue;
                }
                const outcome = await deliverQueuedReportSend(job, async email => {
                    const response = await resend.emails.send({
                        from: email.from,
                        to: email.to,
                        replyTo: email.replyTo,
                        subject: email.subject,
                        html: email.html,
                        text: email.text,
                    }, { idempotencyKey: `report-send-${job.id}` });
                    return !response.error;
                });
                if (outcome === 'failed') throw new Error('Report send will retry');
                if (outcome === 'sent') result.sent++;
                else result.canceled++;
                continue;
            }
            if ([contactResult, clientResult, orgResult].some(item => item.error)) throw new Error('Could not verify recipient');
            const contact = contactResult.data, client = clientResult.data, org = orgResult.data;
            if (!contact || !client || !org || !await eventStillVisible(job)) {
                const { error: cancelError } = await admin.from('client_portal_email_queue').update({ canceled_at: new Date().toISOString() }).eq('id', job.id);
                if (cancelError) throw new Error('Could not cancel notification');
                result.canceled++; continue;
            }
            const subject = SUBJECTS[job.event_kind] ?? 'Your client portal has an update';
            const portal = new URL('/portal/login', process.env.NEXT_PUBLIC_SITE_URL || 'https://seo-ops-center.vercel.app');
            portal.searchParams.set('next', safePortalNext(job.next_path));
            portal.searchParams.set('client', job.client_id);
            const response = await resend.emails.send({ from, to: contact.email,
                subject: `${String(client.name).replace(/[\r\n]/g, ' ')}: ${subject}`,
                html: `<p>${escape(String(org.name))}</p><h1>${escape(subject)}</h1><p>Open your private portal for ${escape(String(client.name))} to see the details.</p><p><a href="${escape(portal.toString())}">Open client portal</a></p><p>Sign in with your invited email address. Your private content stays in the portal.</p>`,
                text: `${org.name}\n${subject}\nOpen your private portal for ${client.name}: ${portal}\nSign in with your invited email address.`,
            }, { idempotencyKey: `client-portal-${job.id}` });
            if (response.error) throw new Error('Provider rejected notification');
            const { error: saveError } = await admin.from('client_portal_email_queue').update({ sent_at: new Date().toISOString() }).eq('id', job.id);
            if (saveError) throw new Error('Could not confirm delivery');
            result.sent++;
        } catch {
            await admin.from('client_portal_email_queue').update({
                claimed_at: null, available_at: new Date(Date.now() + 15 * 60000 * Math.pow(2, job.attempts - 1)).toISOString(),
                ...(job.attempts >= 6 ? { failed_at: new Date().toISOString() } : {}),
            }).eq('id', job.id);
            result.failed++;
        }
    }
    return result;
}

async function eventStillVisible(job: { event_kind: string; event_id: string; organization_id: string; client_id: string }) {
    const admin = createAdminClient();
    const table = { plan: 'client_portal_plan_shares', report: 'client_portal_report_shares', update: 'client_portal_updates',
        request: 'client_portal_waiting_items', reply: 'client_portal_feedback' }[job.event_kind];
    if (!table) return false;
    let query = admin.from(table).select('*').eq('id', job.event_id).eq('organization_id', job.organization_id).eq('client_id', job.client_id);
    if (job.event_kind === 'plan' || job.event_kind === 'report') query = query.is('unshared_at', null);
    if (job.event_kind === 'request') query = query.is('resolved_at', null);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error('Could not verify notification visibility');
    if (!data) return false;
    if (job.event_kind === 'report') {
        const { data: report, error: reportError } = await admin.from('reports').select('id').eq('id', data.report_id)
            .eq('client_id', job.client_id).eq('organization_id', job.organization_id).eq('status', 'published').maybeSingle();
        if (reportError) throw new Error('Could not verify report visibility');
        return Boolean(report);
    }
    if (job.event_kind === 'reply' && data.subject_type !== 'general') {
        const isPlan = data.subject_type === 'plan';
        const { data: subject, error: subjectError } = await admin.from(isPlan ? 'client_portal_plan_shares' : 'client_portal_waiting_items')
            .select('id').eq(isPlan ? 'marketing_plan_id' : 'id', data.subject_id)
            .eq('client_id', job.client_id).eq('organization_id', job.organization_id)
            .is(isPlan ? 'unshared_at' : 'resolved_at', null).maybeSingle();
        if (subjectError) throw new Error('Could not verify reply visibility');
        return Boolean(subject);
    }
    return true;
}

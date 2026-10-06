import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { SEO_PLAN_LABEL } from '@/lib/marketing-plan-template';
import { cleanDisplayName, cleanFeedbackBody, cleanShortText, isUuid, normalizeEmail } from './access-policy';
import { planDecisionState } from './progress';
import { ensureStaffContact, sendContactLink } from './actions';

type StaffFailure = { ok: false; status: number; error: string };
type StaffActor = {
    userId: string;
    actorName: string;
    organizationId: string;
    clientId: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
};

async function authorize(clientId: unknown, write: boolean): Promise<{ ok: true; actor: StaffActor } | StaffFailure> {
    const auth = await requireClientOrgMember(clientId);
    if (!auth.ok) return auth;
    if (write && auth.role === 'viewer') return { ok: false, status: 403, error: 'Forbidden' };
    return { ok: true, actor: auth };
}

export async function loadStaffPortal(clientId: unknown) {
    const auth = await authorize(clientId, false);
    if (!auth.ok) return auth;
    const { actor } = auth;
    const admin = createAdminClient();

    const [
        contactsResult,
        shareResult,
        decisionsResult,
        reportsResult,
        reportSharesResult,
        waitingResult,
        feedbackResult,
        deliverablesResult,
        planResult,
    ] = await Promise.all([
        admin.from('client_portal_contacts')
            .select('id, email, display_name, user_id, revoked_at, created_at')
            .eq('client_id', actor.clientId)
            .eq('organization_id', actor.organizationId)
            .order('created_at', { ascending: true }),
        admin.from('client_portal_plan_shares')
            .select('marketing_plan_id, shared_at, approval_requested_at, unshared_at')
            .eq('client_id', actor.clientId)
            .eq('organization_id', actor.organizationId)
            .is('unshared_at', null)
            .maybeSingle(),
        admin.from('client_portal_plan_decisions')
            .select('id, decision, actor_label, note, decided_at')
            .eq('client_id', actor.clientId)
            .eq('organization_id', actor.organizationId)
            .order('decided_at', { ascending: false })
            .limit(8),
        admin.from('reports')
            .select('id, title, report_month, status')
            .eq('client_id', actor.clientId)
            .eq('organization_id', actor.organizationId)
            .order('report_month', { ascending: false }),
        admin.from('client_portal_report_shares')
            .select('report_id, shared_at')
            .eq('client_id', actor.clientId)
            .eq('organization_id', actor.organizationId)
            .is('unshared_at', null),
        admin.from('client_portal_waiting_items')
            .select('id, title, detail, deliverable_id, created_at, resolved_at')
            .eq('client_id', actor.clientId)
            .eq('organization_id', actor.organizationId)
            .order('created_at', { ascending: false })
            .limit(40),
        admin.from('client_portal_feedback')
            .select('id, subject_type, subject_id, author_label, body, created_at')
            .eq('client_id', actor.clientId)
            .eq('organization_id', actor.organizationId)
            .order('created_at', { ascending: false })
            .limit(40),
        admin.from('deliverables')
            .select('id, title, status')
            .eq('client_id', actor.clientId)
            .eq('organization_id', actor.organizationId)
            .in('status', ['Pending', 'In Progress', 'Review'])
            .order('title', { ascending: true })
            .limit(50),
        admin.from('marketing_plans')
            .select('id, title')
            .eq('client_id', actor.clientId)
            .eq('organization_id', actor.organizationId)
            .maybeSingle(),
    ]);

    const share = shareResult.data;
    const latest = decisionsResult.data?.[0];
    const state = planDecisionState({
        shared: Boolean(share),
        approvalRequestedAt: share ? String(share.approval_requested_at) : null,
        latest: latest
            ? { decision: latest.decision as 'approved' | 'changes_requested', decidedAt: String(latest.decided_at) }
            : null,
    });

    return {
        ok: true as const,
        contacts: contactsResult.data ?? [],
        plan: planResult.data
            ? { id: planResult.data.id as string, title: String(planResult.data.title || SEO_PLAN_LABEL) }
            : null,
        planShare: share
            ? {
                marketingPlanId: share.marketing_plan_id as string,
                sharedAt: String(share.shared_at),
                approvalRequestedAt: String(share.approval_requested_at),
                state,
            }
            : null,
        decisions: decisionsResult.data ?? [],
        reports: reportsResult.data ?? [],
        sharedReportIds: (reportSharesResult.data ?? []).map(row => row.report_id as string),
        waiting: waitingResult.data ?? [],
        feedback: feedbackResult.data ?? [],
        deliverables: deliverablesResult.data ?? [],
    };
}

async function contactInClient(contactId: string, actor: StaffActor) {
    const { data } = await createAdminClient()
        .from('client_portal_contacts')
        .select('id')
        .eq('id', contactId)
        .eq('client_id', actor.clientId)
        .eq('organization_id', actor.organizationId)
        .maybeSingle();
    return Boolean(data);
}

export async function staffInvite(body: Record<string, unknown>) {
    const auth = await authorize(body.clientId, true);
    if (!auth.ok) return auth;
    const email = normalizeEmail(body.email);
    const displayName = cleanDisplayName(body.displayName);
    if (!email || !displayName) return { ok: false, status: 400, error: 'Name and a valid email are required' };

    try {
        const contactId = await ensureStaffContact({
            organizationId: auth.actor.organizationId,
            clientId: auth.actor.clientId,
            email,
            displayName,
            invitedBy: auth.actor.userId,
        });
        const sent = await sendContactLink({
            contactId,
            invitedBy: auth.actor.userId,
            invitedByName: auth.actor.actorName,
            nextPath: typeof body.nextPath === 'string' ? body.nextPath : '/portal',
            email: body.emailLink !== false,
            keepLinkOnEmailFailure: true,
        });
        return {
            ok: true as const,
            link: sent.link,
            emailed: sent.emailed,
            emailRequested: body.emailLink !== false,
        };
    } catch {
        return { ok: false as const, status: 500, error: 'Could not send the portal link' };
    }
}

export async function staffRevoke(body: Record<string, unknown>) {
    const auth = await authorize(body.clientId, true);
    if (!auth.ok) return auth;
    if (!isUuid(body.contactId)) return { ok: false, status: 400, error: 'Unknown contact' };
    if (!await contactInClient(body.contactId, auth.actor)) return { ok: false, status: 404, error: 'Unknown contact' };
    const { error } = await createAdminClient()
        .from('client_portal_contacts')
        .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', body.contactId)
        .eq('client_id', auth.actor.clientId);
    if (error) return { ok: false, status: 500, error: 'Could not revoke access' };
    return { ok: true as const };
}

export async function staffSharePlan(body: Record<string, unknown>, mode: 'share' | 'unshare' | 'again') {
    const auth = await authorize(body.clientId, true);
    if (!auth.ok) return auth;
    const admin = createAdminClient();
    const { data: plan } = await admin
        .from('marketing_plans')
        .select('id')
        .eq('client_id', auth.actor.clientId)
        .eq('organization_id', auth.actor.organizationId)
        .maybeSingle();
    if (!plan) return { ok: false, status: 404, error: 'Create an SEO Plan before sharing it' };

    if (mode === 'unshare') {
        const { error } = await admin
            .from('client_portal_plan_shares')
            .update({ unshared_at: new Date().toISOString() })
            .eq('marketing_plan_id', plan.id)
            .eq('client_id', auth.actor.clientId)
            .is('unshared_at', null);
        if (error) return { ok: false, status: 500, error: 'Could not unshare the plan' };
        return { ok: true as const };
    }

    const { data: live } = await admin
        .from('client_portal_plan_shares')
        .select('id')
        .eq('marketing_plan_id', plan.id)
        .is('unshared_at', null)
        .maybeSingle();

    if (mode === 'again') {
        if (!live) return { ok: false, status: 409, error: 'Share the plan first' };
        const { error } = await admin
            .from('client_portal_plan_shares')
            .update({ approval_requested_at: new Date().toISOString() })
            .eq('id', live.id);
        if (error) return { ok: false, status: 500, error: 'Could not request approval again' };
        return { ok: true as const };
    }

    if (live) return { ok: true as const };
    const { error } = await admin.from('client_portal_plan_shares').insert({
        organization_id: auth.actor.organizationId,
        client_id: auth.actor.clientId,
        marketing_plan_id: plan.id,
        shared_by: auth.actor.userId,
    });
    if (error) return { ok: false, status: 500, error: 'Could not share the plan' };
    return { ok: true as const };
}

export async function staffShareReport(body: Record<string, unknown>, share: boolean) {
    const auth = await authorize(body.clientId, true);
    if (!auth.ok) return auth;
    if (!isUuid(body.reportId)) return { ok: false, status: 400, error: 'Unknown report' };
    const admin = createAdminClient();
    const { data: report } = await admin
        .from('reports')
        .select('id, status, client_id, organization_id')
        .eq('id', body.reportId)
        .maybeSingle();
    if (!report || report.client_id !== auth.actor.clientId || report.organization_id !== auth.actor.organizationId) {
        return { ok: false, status: 404, error: 'Unknown report' };
    }
    if (share && report.status !== 'published') {
        return { ok: false, status: 409, error: 'Publish the report before sharing it' };
    }

    if (!share) {
        const { error } = await admin
            .from('client_portal_report_shares')
            .update({ unshared_at: new Date().toISOString() })
            .eq('report_id', report.id)
            .eq('client_id', auth.actor.clientId)
            .is('unshared_at', null);
        if (error) return { ok: false, status: 500, error: 'Could not unshare the report' };
        return { ok: true as const };
    }

    const { data: live } = await admin
        .from('client_portal_report_shares')
        .select('id')
        .eq('report_id', report.id)
        .is('unshared_at', null)
        .maybeSingle();
    if (live) return { ok: true as const };
    const { error } = await admin.from('client_portal_report_shares').insert({
        organization_id: auth.actor.organizationId,
        client_id: auth.actor.clientId,
        report_id: report.id,
        shared_by: auth.actor.userId,
    });
    if (error) return { ok: false, status: 500, error: 'Could not share the report' };
    return { ok: true as const };
}

export async function staffWaiting(body: Record<string, unknown>, resolve: boolean) {
    const auth = await authorize(body.clientId, true);
    if (!auth.ok) return auth;
    const admin = createAdminClient();
    if (resolve) {
        if (!isUuid(body.waitingId)) return { ok: false, status: 400, error: 'Unknown item' };
        const { error } = await admin
            .from('client_portal_waiting_items')
            .update({ resolved_at: new Date().toISOString() })
            .eq('id', body.waitingId)
            .eq('client_id', auth.actor.clientId)
            .eq('organization_id', auth.actor.organizationId)
            .is('resolved_at', null);
        if (error) return { ok: false, status: 500, error: 'Could not resolve the item' };
        return { ok: true as const };
    }

    const title = cleanShortText(body.title, 140);
    if (!title) return { ok: false, status: 400, error: 'Add a short client-facing title' };
    const detail = body.detail == null || body.detail === '' ? null : cleanShortText(body.detail, 2000);
    if (body.detail && body.detail !== '' && !detail) {
        return { ok: false, status: 400, error: 'Keep the detail under 2000 characters' };
    }
    let deliverableId: string | null = null;
    if (body.deliverableId) {
        if (!isUuid(body.deliverableId)) return { ok: false, status: 400, error: 'Unknown deliverable' };
        const { data: deliverable } = await admin
            .from('deliverables')
            .select('id')
            .eq('id', body.deliverableId)
            .eq('client_id', auth.actor.clientId)
            .eq('organization_id', auth.actor.organizationId)
            .maybeSingle();
        if (!deliverable) return { ok: false, status: 404, error: 'Unknown deliverable' };
        deliverableId = deliverable.id as string;
    }

    const { error } = await admin.from('client_portal_waiting_items').insert({
        organization_id: auth.actor.organizationId,
        client_id: auth.actor.clientId,
        deliverable_id: deliverableId,
        title,
        detail,
        created_by: auth.actor.userId,
    });
    if (error) return { ok: false, status: 500, error: 'Could not add the item' };
    return { ok: true as const };
}

export async function staffReply(input: Record<string, unknown>) {
    const auth = await authorize(input.clientId, true);
    if (!auth.ok) return auth;
    const body = cleanFeedbackBody(input.body);
    if (!body) return { ok: false as const, status: 400, error: 'Write a short reply (up to 2000 characters)' };
    const { actor } = auth;
    const { error } = await createAdminClient().from('client_portal_feedback').insert({
        organization_id: actor.organizationId, client_id: actor.clientId,
        staff_user_id: actor.userId, author_label: actor.actorName,
        subject_type: 'general', subject_id: actor.clientId, body,
    });
    if (error) return { ok: false as const, status: 500, error: 'Could not save the reply' };
    return { ok: true as const };
}

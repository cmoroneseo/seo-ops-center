import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { SEO_PLAN_LABEL } from '@/lib/marketing-plan-template';
import { cleanDisplayName, cleanFeedbackBody, cleanShortText, isUuid, normalizeEmail } from './access-policy';
import { planDecisionState } from './progress';
import { capturePlan, captureReport, samePlanScope, type PortalPlanSnapshot } from './publication';
import { ClientCopyRejected } from '@/lib/reports/copy-rules';
import { loadPortalPlan, feedbackFrom } from './data';
import { conversationNeedsReply, portalReadiness, rowToPortalUpdate, validPortalDate, reportTitleMonthMismatch } from './readiness';
import { portalToday } from './dashboard';
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
            .select('id,marketing_plan_id,shared_at,approval_requested_at,unshared_at,snapshot,version')
            .eq('client_id', actor.clientId)
            .eq('organization_id', actor.organizationId)
            .is('unshared_at', null)
            .maybeSingle(),
        admin.from('client_portal_plan_decisions')
            .select('id,decision,actor_label,note,decided_at,plan_share_id')
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
            .select('id,title,detail,deliverable_id,created_at,resolved_at,due_date,impact')
            .eq('client_id', actor.clientId)
            .eq('organization_id', actor.organizationId)
            .order('created_at', { ascending: false })
            .limit(40),
        admin.from('client_portal_feedback')
            .select('id,subject_type,subject_id,author_label,body,created_at,staff_user_id')
            .eq('client_id', actor.clientId)
            .eq('organization_id', actor.organizationId)
            .order('created_at', { ascending: false })
            .limit(200),
        admin.from('deliverables')
            .select('id,title,status,due_date,delivered_on')
            .eq('client_id', actor.clientId)
            .eq('organization_id', actor.organizationId)
            .in('status', ['Pending', 'In Progress', 'Review', 'Approved'])
            .order('title', { ascending: true })
            .limit(50),
        admin.from('marketing_plans')
            .select('id, title')
            .eq('client_id', actor.clientId)
            .eq('organization_id', actor.organizationId)
            .maybeSingle(),
    ]);

    if ([contactsResult, shareResult, decisionsResult, reportsResult, reportSharesResult, waitingResult, feedbackResult, deliverablesResult, planResult].some(result => result.error)) {
        return { ok: false as const, status: 500, error: 'Could not load portal management. Please try again.' };
    }
    const [draft, updates, settings, timing, conversations, members, client, visits, emails] = await Promise.all([
        capturePlan(actor),
        admin.from('client_portal_updates').select('*').eq('client_id', actor.clientId).eq('organization_id', actor.organizationId).order('published_at', { ascending: false }).limit(1).maybeSingle(),
        admin.from('client_portal_settings').select('analytics_shared').eq('client_id', actor.clientId).eq('organization_id', actor.organizationId).maybeSingle(),
        admin.from('client_portal_delivery_updates').select('*').eq('client_id', actor.clientId).eq('organization_id', actor.organizationId),
        admin.from('client_portal_conversations').select('subject_type,subject_id,owner_id,handled_through_at').eq('client_id', actor.clientId).eq('organization_id', actor.organizationId),
        admin.from('organization_members').select('user_id,role,user:users(full_name)').eq('organization_id', actor.organizationId),
        admin.from('clients').select('account_manager_id,name,launch_date').eq('id', actor.clientId).eq('organization_id', actor.organizationId).single(),
        admin.from('client_portal_visits').select('contact_id,visited_at,visited_on').eq('client_id', actor.clientId).eq('organization_id', actor.organizationId).order('visited_at', { ascending: false }).limit(1000),
        admin.from('client_portal_email_queue').select('sent_at,failed_at,canceled_at').eq('client_id', actor.clientId).eq('organization_id', actor.organizationId).is('sent_at', null).is('canceled_at', null),
    ]);
    if ([updates, settings, timing, conversations, members, client, visits, emails].some(result => result.error)) return { ok: false as const, status: 500, error: 'Could not load portal readiness' };
    const share = shareResult.data;
    const latest = decisionsResult.data?.find(row => row.plan_share_id === share?.id);
    const entries = feedbackFrom(feedbackResult.data ?? []);
    const keys = [...new Set(['general:' + actor.clientId, ...entries.map(entry => entry.subjectType + ':' + entry.subjectId)])];
    const threads = keys.map(key => {
        const [subjectType, subjectId] = key.split(':');
        const thread = entries.filter(entry => entry.subjectType === subjectType && entry.subjectId === subjectId);
        const conversation = conversations.data?.find(row => row.subject_type === subjectType && row.subject_id === subjectId);
        const ownerId = (conversation ? conversation.owner_id : client.data?.account_manager_id) ?? null;
        const waiting = waitingResult.data?.find(row => row.id === subjectId);
        return { subjectType, subjectId, title: subjectType === 'general' ? 'General conversation' : subjectType === 'plan' ? 'SEO Plan' : waiting?.title ?? 'Client request',
            entries: [...thread].sort((a,b) => a.createdAt.localeCompare(b.createdAt)),
            needsReply: (subjectType === 'general' || (subjectType === 'plan' ? Boolean(share && share.marketing_plan_id === subjectId) : Boolean(waiting && !waiting.resolved_at))) && conversationNeedsReply(thread, conversation?.handled_through_at), ownerId,
            latestClientAt: thread.filter(entry => entry.authorType === 'client').sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt ?? null,
            canReply: subjectType === 'general' || (subjectType === 'plan' ? Boolean(share && share.marketing_plan_id === subjectId) : Boolean(waiting && !waiting.resolved_at)),
        };
    });
    const deliveryRows = (deliverablesResult.data ?? []).map(row => ({ ...row, ...(timing.data?.find(update => update.deliverable_id === row.id) ?? {}),
        dueDate: row.due_date, revisedDueDate: timing.data?.find(update => update.deliverable_id === row.id)?.revised_due_date,
        timingNote: timing.data?.find(update => update.deliverable_id === row.id)?.timing_note }));

    const state = planDecisionState({
        shared: Boolean(share),
        approvalRequestedAt: share ? String(share.approval_requested_at) : null,
        latest: latest
            ? { decision: latest.decision as 'approved' | 'changes_requested', decidedAt: String(latest.decided_at) }
            : null,
    });

    return {
        ok: true as const,
        role: actor.role,
        emailAvailable: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
        readiness: portalReadiness({ sharedPlan: Boolean(share?.snapshot), items: draft?.items ?? [], hasUpdate: Boolean(updates.data), deliverables: deliveryRows.filter(row => !(row.status === 'Approved' && row.delivered_on)), today: portalToday() }),
        latestUpdate: updates.data ? rowToPortalUpdate(updates.data) : null,
        analyticsShared: settings.data?.analytics_shared === true,
        threads,
        members: (members.data ?? []).filter(row => row.role !== 'viewer').map(row => ({ id: row.user_id, name: (row.user as unknown as { full_name: string } | null)?.full_name ?? 'Team member' })),
        visits: visits.data ?? [],
        deliveryUpdates: deliveryRows,
        pendingEmails: emails.data?.filter(row => !row.failed_at).length ?? 0,
        failedEmails: emails.data?.filter(row => row.failed_at).length ?? 0,
        contacts: contactsResult.data ?? [],
        plan: planResult.data
            ? { id: planResult.data.id as string, title: String(planResult.data.title || SEO_PLAN_LABEL) }
            : null,
        planShare: share
            ? {
                marketingPlanId: share.marketing_plan_id as string,
                version: share.version,
                needsPublish: !share.snapshot || Boolean(draft && !samePlanScope(share.snapshot as PortalPlanSnapshot, draft)),
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

    const snapshot = await capturePlan(auth.actor);
    if (!snapshot || snapshot.items.length === 0) return { ok: false as const, status: 409, error: 'Add client-facing plan activities before publishing' };
    const { error } = await admin.rpc('publish_client_portal_plan', { p_org: auth.actor.organizationId, p_client: auth.actor.clientId,
        p_plan: plan.id, p_actor: auth.actor.userId, p_snapshot: snapshot });
    if (error) return { ok: false as const, status: 500, error: 'Could not publish the plan version' };
    return { ok: true as const };
}

export async function staffShareReport(body: Record<string, unknown>, share: boolean) {
    const auth = await authorize(body.clientId, true);
    if (!auth.ok) return auth;
    if (!isUuid(body.reportId)) return { ok: false, status: 400, error: 'Unknown report' };
    const admin = createAdminClient();
    const { data: report } = await admin
        .from('reports')
        .select('id,status,client_id,organization_id,title,report_month')
        .eq('id', body.reportId)
        .maybeSingle();
    if (!report || report.client_id !== auth.actor.clientId || report.organization_id !== auth.actor.organizationId) {
        return { ok: false, status: 404, error: 'Unknown report' };
    }
    if (share && reportTitleMonthMismatch(report.title, report.report_month)) return { ok: false as const, status: 409, error: 'The report title and reporting month disagree. Correct them in Reports before sharing.' };
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
    const publishedPlan = await loadPortalPlan({ ...auth.actor, clientName: '', organizationName: '' });
    let snapshot;
    try {
        snapshot = await captureReport({ ...auth.actor, clientName: '', organizationName: '' }, String(report.id),
            publishedPlan.shared && publishedPlan.planId ? { planId: publishedPlan.planId, title: publishedPlan.title, steps: publishedPlan.steps, items: publishedPlan.items, createdAt: publishedPlan.createdAt ?? '' } : null);
    } catch (error) {
        if (error instanceof ClientCopyRejected) return { ok: false as const, status: 409, error: error.message };
        throw error;
    }
    if (!snapshot) return { ok: false as const, status: 409, error: 'Publish the report before sharing it' };
    const { error } = await admin.from('client_portal_report_shares').insert({
        snapshot,
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

    const dueDate = validPortalDate(body.dueDate);
    if (body.dueDate && !dueDate) return { ok: false as const, status: 400, error: 'Choose a valid due date' };
    const impact = body.impact ? cleanShortText(body.impact, 500) : null;
    if (body.impact && !impact) return { ok: false as const, status: 400, error: 'Keep the impact under 500 characters' };
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
        due_date: dueDate, impact,
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
    const subjectType = input.subjectType ?? 'general';
    const subjectId = input.subjectId ?? actor.clientId;
    if (!await validStaffThread(actor, subjectType, subjectId)) return { ok: false as const, status: 404, error: 'That conversation is not available' };
    const { error } = await createAdminClient().from('client_portal_feedback').insert({
        organization_id: actor.organizationId, client_id: actor.clientId,
        staff_user_id: actor.userId, author_label: actor.actorName,
        subject_type: subjectType, subject_id: subjectId, body,
    });
    if (error) return { ok: false as const, status: 500, error: 'Could not save the reply' };
    return { ok: true as const };
}

async function validStaffThread(actor: StaffActor, kind: unknown, id: unknown): Promise<boolean> {
    if (!isUuid(id)) return false;
    if (kind === 'general') return id === actor.clientId;
    const admin = createAdminClient();
    if (kind === 'plan') {
        const { data, error } = await admin.from('client_portal_plan_shares').select('id').eq('marketing_plan_id', id)
            .eq('client_id', actor.clientId).eq('organization_id', actor.organizationId).is('unshared_at', null).maybeSingle();
        return !error && Boolean(data);
    }
    if (kind === 'waiting_item') {
        const { data, error } = await admin.from('client_portal_waiting_items').select('id').eq('id', id)
            .eq('client_id', actor.clientId).eq('organization_id', actor.organizationId).is('resolved_at', null).maybeSingle();
        return !error && Boolean(data);
    }
    return false;
}

export async function staffPublishUpdate(input: Record<string, unknown>) {
    const auth = await authorize(input.clientId, true);
    if (!auth.ok) return auth;
    const shipped = cleanShortText(input.shipped, 2000), impact = cleanShortText(input.impact, 2000), next = cleanShortText(input.nextSteps, 2000);
    const blockers = input.blockers ? cleanShortText(input.blockers, 2000) : null;
    const date = validPortalDate(input.nextUpdateOn);
    if (!shipped || !impact || !next || (input.blockers && !blockers) || !date || date < portalToday()) return { ok: false as const, status: 400, error: 'Complete the update and choose today or a future date for the next update' };
    const { error } = await createAdminClient().from('client_portal_updates').insert({ organization_id: auth.actor.organizationId,
        client_id: auth.actor.clientId, author_id: auth.actor.userId, author_label: auth.actor.actorName,
        shipped, impact, next_steps: next, blockers, next_update_on: date });
    if (error) return { ok: false as const, status: 500, error: 'Could not publish the update' };
    return { ok: true as const };
}

export async function staffAnalytics(input: Record<string, unknown>) {
    const auth = await authorize(input.clientId, true);
    if (!auth.ok) return auth;
    if (typeof input.shared !== 'boolean') return { ok: false as const, status: 400, error: 'Choose a sharing setting' };
    const { error } = await createAdminClient().from('client_portal_settings').upsert({ client_id: auth.actor.clientId,
        organization_id: auth.actor.organizationId, analytics_shared: input.shared }, { onConflict: 'client_id' });
    if (error) return { ok: false as const, status: 500, error: 'Could not save performance visibility' };
    return { ok: true as const };
}

export async function staffDeliveryTiming(input: Record<string, unknown>) {
    const auth = await authorize(input.clientId, true);
    if (!auth.ok) return auth;
    const note = cleanShortText(input.note, 2000), date = validPortalDate(input.revisedDueDate);
    if (!isUuid(input.deliverableId) || !note || (input.revisedDueDate && !date) || !['team', 'client'].includes(String(input.responsibility))) return { ok: false as const, status: 400, error: 'Add a timing explanation, responsible party, and a valid date if known' };
    const admin = createAdminClient();
    const { data, error: lookupError } = await admin.from('deliverables').select('id').eq('id', input.deliverableId)
        .eq('client_id', auth.actor.clientId).eq('organization_id', auth.actor.organizationId).maybeSingle();
    if (lookupError || !data) return { ok: false as const, status: 404, error: 'Unknown deliverable' };
    const { error } = await admin.from('client_portal_delivery_updates').upsert({ deliverable_id: data.id,
        organization_id: auth.actor.organizationId, client_id: auth.actor.clientId, timing_note: note,
        revised_due_date: date, responsibility: input.responsibility, updated_at: new Date().toISOString() }, { onConflict: 'deliverable_id' });
    if (error) return { ok: false as const, status: 500, error: 'Could not save the timing update' };
    return { ok: true as const };
}

export async function staffConversation(input: Record<string, unknown>) {
    const auth = await authorize(input.clientId, true);
    if (!auth.ok) return auth;
    const { actor } = auth;
    if (!await validStaffThread(actor, input.subjectType, input.subjectId)) return { ok: false as const, status: 404, error: 'Unknown conversation' };
    const admin = createAdminClient();
    if (input.ownerId != null && input.ownerId !== '') {
        if (!isUuid(input.ownerId)) return { ok: false as const, status: 400, error: 'Unknown owner' };
        const { data } = await admin.from('organization_members').select('user_id').eq('organization_id', actor.organizationId).eq('user_id', input.ownerId).neq('role','viewer').maybeSingle();
        if (!data) return { ok: false as const, status: 400, error: 'Choose a team member in this organization' };
    }
    // A client can send another note while staff handle an older one. Only mark
    // the displayed note as handled; never cover a later unseen message.
    let handled: string | undefined;
    if (input.handledThrough) {
        const { data } = await admin.from('client_portal_feedback').select('created_at').eq('organization_id', actor.organizationId)
            .eq('client_id', actor.clientId).eq('subject_type', input.subjectType).eq('subject_id', input.subjectId)
            .is('staff_user_id', null).eq('created_at', input.handledThrough).maybeSingle();
        if (!data) return { ok: false as const, status: 409, error: 'Refresh the conversation before marking it handled' };
        handled = data.created_at;
    }
    const { error } = await admin.from('client_portal_conversations').upsert({ organization_id: actor.organizationId,
        client_id: actor.clientId, subject_type: input.subjectType, subject_id: input.subjectId,
        ...(input.ownerId !== undefined ? { owner_id: input.ownerId || null } : {}),
        ...(handled ? { handled_through_at: handled } : {}) }, { onConflict: 'organization_id,client_id,subject_type,subject_id' });
    if (error) return { ok: false as const, status: 500, error: 'Could not update the conversation' };
    return { ok: true as const };
}

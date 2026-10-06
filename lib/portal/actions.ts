import { createHash, randomBytes } from 'node:crypto';
import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase/admin';
import { clientPortalInviteEmail } from '@/lib/email/templates';
import { parseTheme } from '@/lib/theme/palette';
import { defaultExpiry, generateToken, hashToken } from '@/lib/approvals/token';
import {
    cleanFeedbackBody, generalFeedbackAllowed, isUuid, normalizeEmail, portalCallbackUrl, reviewHandoffAllowed,
} from './access-policy';
import { decisionActionAllowed } from './progress';
import { loadPortalPlan } from './data';
import type { PortalContact, PortalIdentity } from './session';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function siteUrl() {
    return process.env.NEXT_PUBLIC_SITE_URL || 'https://seo-ops-center.vercel.app';
}

function hashInvite(token: string) {
    return createHash('sha256').update(token).digest('hex');
}

async function generateAuthLink(email: string, redirectTo: string): Promise<string> {
    const admin = createAdminClient();
    const magic = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo },
    });
    if (!magic.error && magic.data?.properties?.action_link) return magic.data.properties.action_link;

    const invite = await admin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { redirectTo },
    });
    if (invite.error || !invite.data?.properties?.action_link) {
        throw new Error('link_failed');
    }
    return invite.data.properties.action_link;
}

async function sendPortalEmail(input: {
    to: string;
    inviteUrl: string;
    organizationId: string;
    organizationName: string;
    clientName: string;
    invitedByName?: string;
}) {
    const admin = createAdminClient();
    const { data: org } = await admin.from('organizations').select('theme').eq('id', input.organizationId).maybeSingle();
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'SEO Ops Command Center <onboarding@resend.dev>',
        to: input.to,
        subject: `Your ${input.clientName.replace(/[\r\n]/g, ' ')} portal is ready`,
        html: clientPortalInviteEmail({
            inviteUrl: input.inviteUrl,
            organizationName: input.organizationName,
            clientName: input.clientName,
            invitedByName: input.invitedByName,
            theme: parseTheme(org?.theme),
        }),
    });
    if (error) throw new Error('email_failed');
}

async function createInviteToken(contact: {
    id: string;
    organizationId: string;
    clientId: string;
    email: string;
}, invitedBy: string): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    const { error } = await createAdminClient().from('client_portal_invites').insert({
        token_hash: hashInvite(raw),
        contact_id: contact.id,
        organization_id: contact.organizationId,
        client_id: contact.clientId,
        email: contact.email,
        invited_by: invitedBy,
        expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    });
    if (error) throw new Error('invite_failed');
    return raw;
}

export async function sendContactLink(input: {
    contactId: string;
    invitedBy: string;
    invitedByName: string;
    nextPath?: string | null;
    email: boolean;
    /** Staff can still copy the link when Resend is down. Login never returns it. */
    keepLinkOnEmailFailure?: boolean;
}): Promise<{ link: string; emailed: boolean }> {
    const admin = createAdminClient();
    const { data: row, error } = await admin
        .from('client_portal_contacts')
        .select('id, organization_id, client_id, email, display_name, user_id, revoked_at')
        .eq('id', input.contactId)
        .maybeSingle();
    if (error || !row || row.revoked_at) throw new Error('contact_missing');

    const { data: client } = await admin.from('clients').select('name').eq('id', row.client_id).maybeSingle();
    const { data: org } = await admin.from('organizations').select('name').eq('id', row.organization_id).maybeSingle();

    const needsInvite = !row.user_id;
    const portalInvite = needsInvite
        ? await createInviteToken({
            id: row.id as string,
            organizationId: row.organization_id as string,
            clientId: row.client_id as string,
            email: row.email as string,
        }, input.invitedBy)
        : null;

    const link = await generateAuthLink(
        row.email as string,
        portalCallbackUrl(siteUrl(), { portalInvite, nextPath: input.nextPath, clientId: String(row.client_id) }),
    );

    let emailed = false;
    if (input.email) {
        try {
            await sendPortalEmail({
                to: row.email as string,
                inviteUrl: link,
                organizationId: row.organization_id as string,
                organizationName: String(org?.name ?? 'your agency'),
                clientName: String(client?.name ?? 'your account'),
                invitedByName: input.invitedByName,
            });
            emailed = true;
        } catch (error) {
            if (!input.keepLinkOnEmailFailure) throw error;
        }
    }
    return { link, emailed };
}

export async function loginPortalEmail(emailInput: unknown, nextPath: unknown, clientHint?: unknown): Promise<void> {
    const email = normalizeEmail(emailInput);
    if (!email) return;
    const admin = createAdminClient();
    const { data: rows } = await admin
        .from('client_portal_contacts')
        .select('id, user_id, invited_by, client_id')
        .eq('email', email)
        .is('revoked_at', null)
        .order('created_at', { ascending: true });
    if (!rows?.length) return;

    const candidates = isUuid(clientHint) ? rows.filter(row => row.client_id === clientHint) : rows;
    const target = candidates.find(row => row.user_id) ?? candidates[0];
    if (!target) return;
    try {
        await sendContactLink({
            contactId: target.id as string,
            invitedBy: (target.invited_by as string | null) ?? (target.user_id as string),
            invitedByName: 'Your account team',
            nextPath: typeof nextPath === 'string' ? nextPath : '/portal',
            email: true,
        });
    } catch {
        // Same response either way. Do not log the address.
    }
}

export async function ensureStaffContact(input: {
    organizationId: string;
    clientId: string;
    email: string;
    displayName: string;
    invitedBy: string;
}): Promise<string> {
    const admin = createAdminClient();
    const { data: existingRows } = await admin
        .from('client_portal_contacts')
        .select('id, revoked_at')
        .eq('client_id', input.clientId)
        .eq('organization_id', input.organizationId)
        .eq('email', input.email);
    const existing = (existingRows ?? []).find(row => !row.revoked_at) ?? existingRows?.[0];

    if (existing) {
        const { error } = await admin
            .from('client_portal_contacts')
            .update({
                display_name: input.displayName,
                revoked_at: null,
                invited_by: input.invitedBy,
                updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
        if (error) throw new Error('contact_failed');
        return existing.id as string;
    }

    const { data, error } = await admin
        .from('client_portal_contacts')
        .insert({
            organization_id: input.organizationId,
            client_id: input.clientId,
            email: input.email,
            display_name: input.displayName,
            invited_by: input.invitedBy,
        })
        .select('id')
        .single();
    if (error || !data) throw new Error('contact_failed');
    return data.id as string;
}

export async function recordPlanDecision(
    identity: PortalIdentity,
    action: unknown,
    noteInput: unknown,
    revisionInput: unknown,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    if (action !== 'approved' && action !== 'changes_requested') {
        return { ok: false, status: 400, error: 'Choose approve or request changes' };
    }
    const note = noteInput == null || noteInput === '' ? null : cleanFeedbackBody(noteInput);
    if (noteInput && noteInput !== '' && !note) {
        return { ok: false, status: 400, error: 'Keep the note under 2000 characters' };
    }
    if (action === 'changes_requested' && !note) {
        return { ok: false, status: 400, error: 'Tell the team what to change' };
    }

    const plan = await loadPortalPlan(identity.contact);
    if (!plan.shared || !plan.planId) return { ok: false, status: 404, error: 'The plan is not shared yet' };
    if (!isUuid(revisionInput) || revisionInput !== plan.revisionId) return { ok: false, status: 409, error: 'The plan has a new version. Refresh the page and review it before deciding.' };
    if (!decisionActionAllowed(plan.state, action)) {
        return { ok: false, status: 409, error: 'That decision is already recorded' };
    }

    const admin = createAdminClient();
    const { data: saved, error } = await admin.rpc('record_client_portal_decision', {
        p_contact: identity.contact.id, p_user: identity.userId, p_share: revisionInput, p_decision: action, p_note: note,
    });
    if (error) return { ok: false, status: 500, error: 'Could not save the decision' };
    if (!saved) return { ok: false, status: 409, error: 'The plan or your access changed. Refresh and review the current version.' };
    await notifyPortalFeedback(identity.contact, undefined, action === 'approved' ? 'SEO plan approved' : 'SEO plan changes requested', 'plan', plan.planId);
    return { ok: true };
}

export async function addPortalFeedback(
    identity: PortalIdentity,
    subjectType: unknown,
    subjectId: unknown,
    bodyInput: unknown,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    const body = cleanFeedbackBody(bodyInput);
    if (!body) return { ok: false, status: 400, error: 'Write a short note (up to 2000 characters)' };
    if (subjectType !== 'plan' && subjectType !== 'waiting_item' && subjectType !== 'general') {
        return { ok: false, status: 400, error: 'Unknown item' };
    }
    if (!isUuid(subjectId)) return { ok: false, status: 400, error: 'Unknown item' };

    const admin = createAdminClient();
    const contact = identity.contact;
    if (subjectType === 'plan') {
        const { data } = await admin
            .from('client_portal_plan_shares')
            .select('id')
            .eq('marketing_plan_id', subjectId)
            .eq('client_id', contact.clientId)
            .eq('organization_id', contact.organizationId)
            .is('unshared_at', null)
            .maybeSingle();
        if (!data) return { ok: false, status: 404, error: 'The plan is not shared yet' };
    } else if (subjectType === 'waiting_item') {
        const { data } = await admin
            .from('client_portal_waiting_items')
            .select('id')
            .eq('id', subjectId)
            .eq('client_id', contact.clientId)
            .eq('organization_id', contact.organizationId)
            .is('resolved_at', null)
            .maybeSingle();
        if (!data) return { ok: false, status: 404, error: 'That item is no longer waiting on you' };
    }

    if (subjectType === 'general' && !generalFeedbackAllowed(subjectId, contact.clientId)) {
        return { ok: false, status: 403, error: 'Unknown conversation' };
    }

    const { data: saved, error } = await admin.from('client_portal_feedback').insert({
        organization_id: contact.organizationId,
        client_id: contact.clientId,
        contact_id: contact.id,
        author_label: contact.displayName,
        subject_type: subjectType,
        subject_id: subjectId,
        body,
    }).select('id').single();
    if (error) return { ok: false, status: 500, error: 'Could not save the note' };
    await notifyPortalFeedback(contact, String(saved.id), 'new client message', String(subjectType), String(subjectId));
    return { ok: true };
}

export async function mintReviewHandoff(
    contact: PortalContact,
    batchId: string,
    userId: string,
): Promise<{ ok: true; token: string } | { ok: false; status: 404 | 429 }> {
    if (!isUuid(batchId)) return { ok: false, status: 404 };
    const admin = createAdminClient();
    const { data: batch } = await admin
        .from('content_approval_batches')
        .select('id, organization_id, client_id, status')
        .eq('id', batchId)
        .eq('client_id', contact.clientId)
        .eq('organization_id', contact.organizationId)
        .eq('status', 'in_review')
        .maybeSingle();
    if (!batch) return { ok: false, status: 404 };

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
        .from('content_share_links')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', batchId)
        .gte('created_at', since);
    if (!reviewHandoffAllowed(count ?? 0)) return { ok: false, status: 429 };

    const token = generateToken();
    const { error } = await admin.from('content_share_links').insert({
        batch_id: batchId,
        organization_id: batch.organization_id,
        token_hash: hashToken(token),
        allow_comments: true,
        expires_at: defaultExpiry(),
        created_by: userId,
    });
    if (error) return { ok: false, status: 404 };
    return { ok: true, token };
}

async function notifyPortalFeedback(contact: PortalContact, feedbackId?: string, activity = 'new client message', subjectType?: string, subjectId?: string): Promise<void> {
    try {
        const admin = createAdminClient();
        const { data: client } = await admin.from('clients').select('account_manager_id')
            .eq('id', contact.clientId).eq('organization_id', contact.organizationId).maybeSingle();
        const { data: conversation } = subjectType && subjectId ? await admin.from('client_portal_conversations').select('owner_id')
            .eq('organization_id', contact.organizationId).eq('client_id', contact.clientId).eq('subject_type', subjectType).eq('subject_id', subjectId).maybeSingle() : { data: null };
        const owner = conversation?.owner_id ?? client?.account_manager_id;
        if (!owner) return;
        const { data: member } = await admin.from('organization_members').select('user_id')
            .eq('organization_id', contact.organizationId).eq('user_id', owner).maybeSingle();
        if (!member) return;
        await admin.from('notifications').insert({
            organization_id: contact.organizationId, user_id: member.user_id,
            type: 'portal_feedback', title: `${contact.clientName}: ${activity}`,
            body: `View the update from ${contact.displayName} in the client portal workspace.`,
            entity_type: feedbackId ? 'client_portal_feedback' : null, entity_id: feedbackId ?? null, client_id: contact.clientId,
        });
    } catch {
        // A saved note remains successful even if the bell is unavailable.
    }
}

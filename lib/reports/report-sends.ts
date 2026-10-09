/**
 * Business day 5 at 9:00 AM Pacific. Sends an approved version once.
 * REPORT_SEND_ENABLED must be the string true. While it is off, this writes nothing.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { buildReportEmail } from './email';
import { reportSendEnabled } from './send-flag';
import {
    planReportSends,
    sendWindowOpen,
    type DueReview,
    type PlannedSend,
} from './schedule';
import { clientReportFromSnapshot, type ClientReportModel } from './render-model';

export interface ApplyCounts {
    emailed: number;
    flaggedNoContact: number;
    queued: number;
    skipped: number;
    conflicts: number;
    unavailable: boolean;
}

export interface SendStore {
    listReviews(): Promise<{ ok: true; reviews: DueReview[] } | { ok: false; unavailable: boolean }>;
    insertSend(plan: PlannedSend): Promise<{ ok: true; id: string; inserted: boolean } | { ok: false; unavailable: boolean }>;
    scheduleReview(plan: PlannedSend): Promise<'ok' | 'conflict' | 'unavailable'>;
    publishPortal(plan: PlannedSend): Promise<'ok' | 'conflict' | 'unavailable'>;
    enqueue(plan: PlannedSend, sendId: string): Promise<'ok' | 'unavailable'>;
}

function emptyCounts(): ApplyCounts {
    return { emailed: 0, flaggedNoContact: 0, queued: 0, skipped: 0, conflicts: 0, unavailable: false };
}

export async function applySendPlan(store: SendStore, plans: PlannedSend[]): Promise<ApplyCounts> {
    const counts = emptyCounts();
    for (const plan of plans) {
        if (plan.action === 'skip') {
            counts.skipped += 1;
            continue;
        }
        const published = await store.publishPortal(plan);
        if (published === 'unavailable') {
            counts.unavailable = true;
            return counts;
        }
        if (published === 'conflict') {
            counts.conflicts += 1;
            continue;
        }
        if (plan.action === 'portal_only') {
            if (plan.insert) {
                const inserted = await store.insertSend(plan);
                if (!inserted.ok) {
                    if (inserted.unavailable) {
                        counts.unavailable = true;
                        return counts;
                    }
                    counts.conflicts += 1;
                    continue;
                }
            }
            counts.flaggedNoContact += 1;
            continue;
        }
        if (plan.review.state === 'approved') {
            const scheduled = await store.scheduleReview(plan);
            if (scheduled === 'unavailable') {
                counts.unavailable = true;
                return counts;
            }
            if (scheduled === 'conflict') {
                counts.conflicts += 1;
                continue;
            }
        }
        const inserted = await store.insertSend(plan);
        if (!inserted.ok) {
            if (inserted.unavailable) {
                counts.unavailable = true;
                return counts;
            }
            counts.conflicts += 1;
            continue;
        }
        const queued = await store.enqueue(plan, inserted.id);
        if (queued === 'unavailable') {
            counts.unavailable = true;
            return counts;
        }
        counts.queued += 1;
    }
    return counts;
}

export interface SendHandlerDeps {
    authorize: (request: Request) => boolean;
    enabled: () => boolean;
    now: () => Date;
    windowOpen: (now: Date) => boolean;
    run: (now: Date) => Promise<
        | { ok: true; skipped: true; reason: 'outside_send_window' | 'disabled' }
        | { ok: true; skipped: false; emailed: number; flaggedNoContact: number; queued: number; skippedCount: number; conflicts: number }
        | { ok: false; status: number; error: string }
    >;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

export function createReportSendHandler(deps: SendHandlerDeps) {
    return async function handle(request: Request) {
        if (!deps.authorize(request)) return json({ error: 'Unauthorized' }, 401);
        if (!deps.enabled()) return json({ skipped: true, reason: 'disabled' });
        const now = deps.now();
        if (!deps.windowOpen(now)) return json({ skipped: true, reason: 'outside_send_window' });
        const result = await deps.run(now);
        if (!result.ok) return json({ error: result.error }, result.status);
        if (result.skipped) return json({ skipped: true, reason: result.reason });
        return json({
            ok: true,
            emailed: result.emailed,
            flaggedNoContact: result.flaggedNoContact,
            queued: result.queued,
            skipped: result.skippedCount,
            conflicts: result.conflicts,
        });
    };
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

export function reportSendHandler() {
    return createReportSendHandler({
        authorize(request) {
            const secret = process.env.CRON_SECRET;
            return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
        },
        enabled: reportSendEnabled,
        now: () => new Date(),
        windowOpen: now => sendWindowOpen(now),
        run: runReportSends,
    });
}

export async function runReportSends(now: Date): Promise<
    | { ok: true; skipped: true; reason: 'outside_send_window' | 'disabled' }
    | { ok: true; skipped: false; emailed: number; flaggedNoContact: number; queued: number; skippedCount: number; conflicts: number }
    | { ok: false; status: number; error: string }
> {
    if (!reportSendEnabled()) return { ok: true, skipped: true, reason: 'disabled' };
    if (!sendWindowOpen(now)) return { ok: true, skipped: true, reason: 'outside_send_window' };
    try {
        const store = supabaseSendStore();
        const listed = await store.listReviews();
        if (!listed.ok) {
            return listed.unavailable
                ? { ok: false, status: 503, error: 'Report sends are not available yet.' }
                : { ok: false, status: 500, error: 'Report sends will retry on the next run.' };
        }
        const planned = planReportSends({ now, reviews: listed.reviews });
        const applied = await applySendPlan(store, planned);
        if (applied.unavailable) return { ok: false, status: 503, error: 'Report sends are not available yet.' };
        const emailed = await deliverQueuedReportSends();
        if (!emailed.ok) return { ok: false, status: 500, error: 'Report sends will retry on the next run.' };
        return {
            ok: true,
            skipped: false,
            emailed: emailed.sent,
            flaggedNoContact: applied.flaggedNoContact,
            queued: applied.queued,
            skippedCount: applied.skipped,
            conflicts: applied.conflicts,
        };
    } catch {
        return { ok: false, status: 500, error: 'Report sends will retry on the next run.' };
    }
}

function unavailable(error: { code?: string } | null): boolean {
    return error?.code === '42P01' || error?.code === '42883';
}

export function supabaseSendStore(): SendStore {
    const admin = createAdminClient();
    return {
        async listReviews() {
            const reviews = await admin.from('report_reviews')
                .select('id, organization_id, client_id, report_id, state, current_version_id, recipient_contact_id, scheduled_for')
                .in('state', ['approved', 'scheduled']);
            if (reviews.error) return { ok: false, unavailable: unavailable(reviews.error) };
            const rows = reviews.data ?? [];
            const versionIds = rows.map(row => text(row.current_version_id)).filter((id): id is string => Boolean(id));
            const sends = versionIds.length === 0
                ? { data: [], error: null }
                : await admin.from('report_sends').select('id, version_id, status').in('version_id', versionIds);
            if (sends.error) return { ok: false, unavailable: unavailable(sends.error) };
            const sendByVersion = new Map((sends.data ?? []).map(row => [String(row.version_id), String(row.status)]));
            const contacts = await admin.from('client_portal_contacts')
                .select('id, client_id, organization_id, revoked_at')
                .in('client_id', [...new Set(rows.map(row => String(row.client_id)))])
                .is('revoked_at', null);
            if (contacts.error) return { ok: false, unavailable: unavailable(contacts.error) };
            const live = new Map<string, string>();
            for (const contact of contacts.data ?? []) {
                const key = `${contact.organization_id}:${contact.client_id}`;
                if (!live.has(key)) live.set(key, String(contact.id));
            }
            const listed: DueReview[] = [];
            for (const row of rows) {
                const versionId = text(row.current_version_id);
                if (!versionId) continue;
                const version = await admin.from('report_versions')
                    .select('id, report_id')
                    .eq('id', versionId)
                    .eq('report_id', row.report_id)
                    .eq('organization_id', row.organization_id)
                    .eq('client_id', row.client_id)
                    .maybeSingle();
                if (version.error) return { ok: false, unavailable: unavailable(version.error) };
                if (!version.data) continue;
                const report = await admin.from('reports')
                    .select('report_month')
                    .eq('id', row.report_id)
                    .eq('organization_id', row.organization_id)
                    .eq('client_id', row.client_id)
                    .maybeSingle();
                if (report.error) return { ok: false, unavailable: unavailable(report.error) };
                const recipient = text(row.recipient_contact_id);
                const key = `${row.organization_id}:${row.client_id}`;
                const recipientLive = recipient && (contacts.data ?? []).some(contact => contact.id === recipient && contact.organization_id === row.organization_id && contact.client_id === row.client_id);
                const status = sendByVersion.get(versionId);
                listed.push({
                    reviewId: String(row.id),
                    reportId: String(row.report_id),
                    versionId,
                    organizationId: String(row.organization_id),
                    clientId: String(row.client_id),
                    state: String(row.state),
                    scheduledFor: text(row.scheduled_for),
                    reportMonth: String(report.data?.report_month ?? ''),
                    contactId: recipient ? (recipientLive ? recipient : null) : live.get(key) ?? null,
                    sendStatus: status === 'queued' || status === 'sent' || status === 'skipped_no_contact' || status === 'canceled' ? status : null,
                });
            }
            return { ok: true, reviews: listed };
        },
        async insertSend(plan) {
            if (!plan.insert) {
                const existing = await admin.from('report_sends').select('id')
                    .eq('version_id', plan.review.versionId)
                    .eq('organization_id', plan.review.organizationId)
                    .eq('client_id', plan.review.clientId)
                    .maybeSingle();
                if (existing.error) return { ok: false, unavailable: unavailable(existing.error) };
                if (!existing.data?.id) return { ok: false, unavailable: false };
                return { ok: true, id: String(existing.data.id), inserted: false };
            }
            const status = plan.action === 'portal_only' ? 'skipped_no_contact' : 'queued';
            const inserted = await admin.from('report_sends').insert({
                organization_id: plan.review.organizationId,
                client_id: plan.review.clientId,
                report_id: plan.review.reportId,
                version_id: plan.review.versionId,
                review_id: plan.review.reviewId,
                contact_id: plan.action === 'portal_only' ? null : plan.review.contactId,
                scheduled_for: plan.scheduledFor,
                status,
            }).select('id').maybeSingle();
            if (inserted.error?.code === '23505') {
                const existing = await admin.from('report_sends').select('id')
                    .eq('version_id', plan.review.versionId)
                    .eq('organization_id', plan.review.organizationId)
                    .maybeSingle();
                if (existing.error || !existing.data?.id) return { ok: false, unavailable: unavailable(existing.error) };
                return { ok: true, id: String(existing.data.id), inserted: false };
            }
            if (inserted.error || !inserted.data?.id) return { ok: false, unavailable: unavailable(inserted.error) };
            return { ok: true, id: String(inserted.data.id), inserted: true };
        },
        async scheduleReview(plan) {
            if (!plan.review.contactId || !plan.scheduledFor) return 'conflict';
            const updated = await admin.from('report_reviews').update({
                state: 'scheduled',
                recipient_contact_id: plan.review.contactId,
                scheduled_for: plan.scheduledFor,
            }).eq('id', plan.review.reviewId)
                .eq('organization_id', plan.review.organizationId)
                .eq('client_id', plan.review.clientId)
                .eq('state', 'approved')
                .select('id');
            if (updated.error) return unavailable(updated.error) ? 'unavailable' : 'conflict';
            if (updated.data?.length) return 'ok';
            const current = await admin.from('report_reviews').select('state')
                .eq('id', plan.review.reviewId)
                .eq('organization_id', plan.review.organizationId)
                .eq('client_id', plan.review.clientId)
                .maybeSingle();
            if (current.error) return unavailable(current.error) ? 'unavailable' : 'conflict';
            return current.data?.state === 'scheduled' ? 'ok' : 'conflict';
        },
        async publishPortal(plan) {
            const version = await admin.from('report_versions').select('snapshot')
                .eq('id', plan.review.versionId)
                .eq('report_id', plan.review.reportId)
                .eq('organization_id', plan.review.organizationId)
                .eq('client_id', plan.review.clientId)
                .maybeSingle();
            if (version.error) return unavailable(version.error) ? 'unavailable' : 'conflict';
            if (!version.data?.snapshot || typeof version.data.snapshot !== 'object' || Array.isArray(version.data.snapshot)) {
                return 'conflict';
            }
            const portal = (version.data.snapshot as { portal?: unknown }).portal;
            const body = portal && typeof portal === 'object' && !Array.isArray(portal) ? portal : { id: plan.review.reportId };
            const published = await admin.rpc('publish_frozen_report_share', {
                p_org: plan.review.organizationId,
                p_client: plan.review.clientId,
                p_report: plan.review.reportId,
                p_snapshot: body,
            });
            if (published.error) return unavailable(published.error) ? 'unavailable' : 'conflict';
            return 'ok';
        },
        async enqueue(plan, sendId) {
            const inserted = await admin.from('client_portal_email_queue').insert({
                organization_id: plan.review.organizationId,
                client_id: plan.review.clientId,
                contact_id: plan.review.contactId,
                event_kind: 'report_send',
                event_id: sendId,
                next_path: `/portal/reports/${plan.review.reportId}`,
            });
            if (inserted.error?.code === '23505') return 'ok';
            if (inserted.error) return 'unavailable';
            return 'ok';
        },
    };
}

interface QueueJob {
    id: string;
    organization_id: string;
    client_id: string;
    contact_id: string;
    event_id: string;
    attempts: number;
}

export async function deliverQueuedReportSend(job: QueueJob, send: (email: NonNullable<ReturnType<typeof buildReportEmail>>) => Promise<boolean>): Promise<'sent' | 'canceled' | 'failed'> {
    const admin = createAdminClient();
    const loaded = await loadSendable(admin, job);
    if (loaded === 'missing') {
        await admin.from('client_portal_email_queue').update({ canceled_at: new Date().toISOString() }).eq('id', job.id);
        return 'canceled';
    }
    if (!loaded) return 'failed';
    if (loaded.alreadySent) {
        await markReviewSent(admin, loaded);
        await admin.from('client_portal_email_queue').update({ sent_at: new Date().toISOString() }).eq('id', job.id);
        return 'sent';
    }
    const email = buildReportEmail(loaded.email);
    if (!email) return 'failed';
    const accepted = await send(email);
    if (!accepted) return 'failed';
    const sentAt = new Date().toISOString();
    const saved = await admin.from('report_sends').update({ status: 'sent', sent_at: sentAt })
        .eq('id', loaded.sendId)
        .eq('organization_id', job.organization_id)
        .eq('client_id', job.client_id)
        .eq('status', 'queued');
    if (saved.error) return 'failed';
    await markReviewSent(admin, loaded, sentAt);
    await admin.from('client_portal_email_queue').update({ sent_at: sentAt }).eq('id', job.id);
    return 'sent';
}

async function markReviewSent(admin: ReturnType<typeof createAdminClient>, loaded: Sendable, sentAt = new Date().toISOString()) {
    await admin.from('report_reviews').update({ state: 'sent', sent_at: sentAt })
        .eq('id', loaded.reviewId)
        .eq('organization_id', loaded.organizationId)
        .eq('client_id', loaded.clientId)
        .eq('state', 'scheduled');
}

interface Sendable {
    alreadySent: boolean;
    sendId: string;
    reviewId: string;
    organizationId: string;
    clientId: string;
    email: Parameters<typeof buildReportEmail>[0];
}

async function loadSendable(admin: ReturnType<typeof createAdminClient>, job: QueueJob): Promise<Sendable | 'missing' | null> {
    const sendRow = await admin.from('report_sends').select('id, status, version_id, review_id, report_id, organization_id, client_id, contact_id')
        .eq('id', job.event_id)
        .eq('organization_id', job.organization_id)
        .eq('client_id', job.client_id)
        .maybeSingle();
    if (sendRow.error || !sendRow.data) return sendRow.error ? null : 'missing';
    if (sendRow.data.contact_id !== job.contact_id) return 'missing';
    const [version, contact, client, org] = await Promise.all([
        admin.from('report_versions').select('snapshot').eq('id', sendRow.data.version_id).eq('report_id', sendRow.data.report_id).eq('organization_id', job.organization_id).eq('client_id', job.client_id).maybeSingle(),
        admin.from('client_portal_contacts').select('email').eq('id', job.contact_id).eq('client_id', job.client_id).eq('organization_id', job.organization_id).is('revoked_at', null).maybeSingle(),
        admin.from('clients').select('name, account_manager_id').eq('id', job.client_id).eq('organization_id', job.organization_id).maybeSingle(),
        admin.from('organizations').select('name').eq('id', job.organization_id).maybeSingle(),
    ]);
    if (version.error || contact.error || client.error || org.error) return null;
    if (!version.data?.snapshot || !contact.data?.email || !client.data || !org.data) return 'missing';
    const managerId = text(client.data.account_manager_id);
    let amName = 'Your account manager';
    let amEmail: string | null = null;
    if (managerId) {
        const manager = await admin.from('users').select('full_name, email').eq('id', managerId).maybeSingle();
        if (manager.error) return null;
        if (text(manager.data?.full_name)) amName = String(manager.data?.full_name);
        amEmail = text(manager.data?.email);
    }
    if (!amEmail) return 'missing';
    const model = clientReportFromSnapshot(version.data.snapshot);
    if (!model) return 'missing';
    return {
        alreadySent: sendRow.data.status === 'sent',
        sendId: String(sendRow.data.id),
        reviewId: String(sendRow.data.review_id),
        organizationId: job.organization_id,
        clientId: job.client_id,
        email: {
            model,
            amName,
            amEmail,
            agencyName: String(org.data.name ?? 'Your agency'),
            verifiedFrom: process.env.RESEND_FROM_EMAIL ?? '',
            to: String(contact.data.email),
            siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://seo-ops-center.vercel.app',
            clientId: job.client_id,
            reportId: String(sendRow.data.report_id),
        },
    };
}

async function deliverQueuedReportSends(): Promise<{ ok: true; sent: number } | { ok: false }> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) return { ok: true, sent: 0 };
    const admin = createAdminClient();
    const claimed = await admin.rpc('claim_client_portal_emails', { p_limit: 20, p_kind: 'report_send' });
    if (claimed.error) return { ok: false };
    let sent = 0;
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    for (const job of claimed.data ?? []) {
        try {
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
            if (outcome === 'sent') sent += 1;
            if (outcome === 'failed') throw new Error('Report send will retry');
        } catch {
            await admin.from('client_portal_email_queue').update({
                claimed_at: null,
                available_at: new Date(Date.now() + 15 * 60000 * Math.pow(2, Math.max(0, Number(job.attempts) - 1))).toISOString(),
                ...(Number(job.attempts) >= 6 ? { failed_at: new Date().toISOString() } : {}),
            }).eq('id', job.id);
        }
    }
    return { ok: true, sent };
}

export type { ClientReportModel };

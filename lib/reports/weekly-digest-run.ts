/**
 * Monday Pacific digest cron.
 * WEEKLY_DIGEST_ENABLED must be the string true. While it is off, this
 * writes nothing and claims nothing.
 * New digests are composed only on Monday PT. Already queued sends can
 * retry on a later day that same week, still behind the flag.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { weeklyDigestEnabled } from './digest-flag';
import {
    decideDigestCompose,
    decideDigestDelivery,
    digestWeek,
    weekForQueuedAt,
    type DigestCandidate,
    type DigestDeliverable,
    type DigestWeek,
    type WeeklyDigestEmail,
} from './weekly-digest';

export interface DigestCounts {
    queued: number;
    emailed: number;
    skipped: number;
    canceled: number;
}

export interface DigestQueueJob {
    id: string;
    organization_id: string;
    client_id: string;
    contact_id: string;
    event_id: string;
    attempts: number;
    created_at: string;
}

export interface DigestStore {
    listCandidates(week: DigestWeek): Promise<{ ok: true; candidates: DigestCandidate[] } | { ok: false; unavailable: boolean }>;
    enqueue(input: { organizationId: string; clientId: string; contactId: string; eventId: string }): Promise<'ok' | 'duplicate' | 'unavailable'>;
    claim(): Promise<{ ok: true; jobs: DigestQueueJob[] } | { ok: false; unavailable: boolean }>;
    hydrate(job: DigestQueueJob, week: DigestWeek): Promise<{ ok: true; candidate: DigestCandidate; to: string } | { ok: false; missing: boolean; unavailable: boolean }>;
    markSent(id: string): Promise<boolean>;
    cancel(id: string): Promise<boolean>;
    release(job: DigestQueueJob): Promise<void>;
}

export type DigestRunResult =
    | { ok: true; skipped: true; reason: 'disabled' | 'outside_send_window' }
    | { ok: true; skipped: false; queued: number; emailed: number; skippedCount: number; canceled: number }
    | { ok: false; status: number; error: string };

const RETRY = 'Weekly digests will retry on the next run.';
const UNAVAILABLE = 'Weekly digests are not available yet.';

function text(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function unavailable(error: { code?: string; message?: string } | null): boolean {
    if (!error) return false;
    if (error.code === '42P01' || error.code === '42703' || error.code === '42883' || error.code === 'PGRST204') return true;
    const message = error.message ?? '';
    return /weekly_digest/i.test(message) && (/schema cache/i.test(message) || /does not exist/i.test(message));
}

export async function composeDigests(store: DigestStore, week: DigestWeek): Promise<
    | { ok: true; queued: number; skipped: number }
    | { ok: false; unavailable: boolean }
> {
    const listed = await store.listCandidates(week);
    if (!listed.ok) return { ok: false, unavailable: listed.unavailable };
    let queued = 0;
    let skipped = 0;
    for (const candidate of listed.candidates) {
        const decision = decideDigestCompose({ candidate, week });
        if (decision.action === 'skip') {
            skipped += 1;
            continue;
        }
        for (const contactId of decision.contactIds) {
            const inserted = await store.enqueue({
                organizationId: candidate.organizationId,
                clientId: candidate.clientId,
                contactId,
                eventId: decision.eventId,
            });
            if (inserted === 'unavailable') return { ok: false, unavailable: true };
            if (inserted === 'ok') queued += 1;
        }
    }
    return { ok: true, queued, skipped };
}

export async function deliverDigests(
    store: DigestStore,
    now: Date,
    send: (email: WeeklyDigestEmail, jobId: string) => Promise<boolean>,
): Promise<{ ok: true; emailed: number; canceled: number } | { ok: false; unavailable: boolean }> {
    const verifiedFrom = process.env.RESEND_FROM_EMAIL ?? '';
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://seo-ops-center.vercel.app';
    if (!process.env.RESEND_API_KEY || !verifiedFrom) return { ok: true, emailed: 0, canceled: 0 };
    let emailed = 0;
    let canceled = 0;
    for (let round = 0; round < 8; round += 1) {
        const claimed = await store.claim();
        if (!claimed.ok) return { ok: false, unavailable: claimed.unavailable };
        if (claimed.jobs.length === 0) break;
        for (const job of claimed.jobs) {
            try {
                const week = weekForQueuedAt(job.created_at);
                if (!week) {
                    if (!await store.cancel(job.id)) return { ok: false, unavailable: false };
                    canceled += 1;
                    continue;
                }
                const loaded = await store.hydrate(job, week);
                if (!loaded.ok) {
                    if (loaded.unavailable) return { ok: false, unavailable: true };
                    if (!await store.cancel(job.id)) return { ok: false, unavailable: false };
                    canceled += 1;
                    continue;
                }
                const decision = decideDigestDelivery({
                    now,
                    createdAt: job.created_at,
                    eventId: job.event_id,
                    candidate: loaded.candidate,
                    verifiedFrom,
                    to: loaded.to,
                    siteUrl,
                });
                if (decision.action === 'cancel') {
                    if (!await store.cancel(job.id)) return { ok: false, unavailable: false };
                    canceled += 1;
                    continue;
                }
                if (decision.action === 'retry') {
                    await store.release(job);
                    continue;
                }
                const accepted = await send(decision.email, job.id);
                if (!accepted) {
                    await store.release(job);
                    continue;
                }
                if (!await store.markSent(job.id)) return { ok: false, unavailable: false };
                emailed += 1;
            } catch {
                await store.release(job);
            }
        }
    }
    return { ok: true, emailed, canceled };
}

export async function runWeeklyDigests(now: Date, store?: DigestStore): Promise<DigestRunResult> {
    if (!weeklyDigestEnabled()) return { ok: true, skipped: true, reason: 'disabled' };
    try {
        const db = store ?? supabaseDigestStore();
        const week = digestWeek(now);
        let queued = 0;
        let skipped = 0;
        if (week) {
            const composed = await composeDigests(db, week);
            if (!composed.ok) {
                return composed.unavailable
                    ? { ok: false, status: 503, error: UNAVAILABLE }
                    : { ok: false, status: 500, error: RETRY };
            }
            queued = composed.queued;
            skipped = composed.skipped;
        }
        const delivered = await deliverDigests(db, now, sendDigestEmail);
        if (!delivered.ok) {
            return delivered.unavailable
                ? { ok: false, status: 503, error: UNAVAILABLE }
                : { ok: false, status: 500, error: RETRY };
        }
        if (!week && delivered.emailed === 0 && delivered.canceled === 0) {
            return { ok: true, skipped: true, reason: 'outside_send_window' };
        }
        return {
            ok: true,
            skipped: false,
            queued,
            emailed: delivered.emailed,
            skippedCount: skipped,
            canceled: delivered.canceled,
        };
    } catch {
        return { ok: false, status: 500, error: RETRY };
    }
}

async function sendDigestEmail(email: WeeklyDigestEmail, jobId: string): Promise<boolean> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return false;
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const response = await resend.emails.send({
        from: email.from,
        to: email.to,
        replyTo: email.replyTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
    }, { idempotencyKey: `weekly-digest-${jobId}` });
    return !response.error;
}

export interface DigestHandlerDeps {
    authorize: (request: Request) => boolean;
    enabled: () => boolean;
    now: () => Date;
    run: (now: Date) => Promise<DigestRunResult>;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

export function createWeeklyDigestHandler(deps: DigestHandlerDeps) {
    return async function handle(request: Request) {
        if (!deps.authorize(request)) return json({ error: 'Unauthorized' }, 401);
        if (!deps.enabled()) return json({ skipped: true, reason: 'disabled' });
        const result = await deps.run(deps.now());
        if (!result.ok) return json({ error: result.error }, result.status);
        if (result.skipped) return json({ skipped: true, reason: result.reason });
        return json({
            ok: true,
            queued: result.queued,
            emailed: result.emailed,
            skipped: result.skippedCount,
            canceled: result.canceled,
        });
    };
}

export function weeklyDigestHandler() {
    return createWeeklyDigestHandler({
        authorize(request) {
            const secret = process.env.CRON_SECRET;
            return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
        },
        enabled: weeklyDigestEnabled,
        now: () => new Date(),
        run: now => runWeeklyDigests(now),
    });
}

function chunks<T>(values: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
    return out;
}

async function rowsFor<T extends Record<string, unknown>>(
    load: (ids: string[]) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>,
    ids: string[],
): Promise<{ ok: true; rows: T[] } | { ok: false; error: { code?: string; message?: string } }> {
    const rows: T[] = [];
    for (const group of chunks(ids, 100)) {
        const result = await load(group);
        if (result.error) return { ok: false, error: result.error };
        rows.push(...(result.data ?? []));
    }
    return { ok: true, rows };
}

export function supabaseDigestStore(): DigestStore {
    const admin = createAdminClient();
    return {
        async listCandidates(week) {
            const settings = await admin.from('client_portal_settings')
                .select('client_id, organization_id')
                .eq('weekly_digest', true);
            if (settings.error) return { ok: false, unavailable: unavailable(settings.error) };
            const opted = (settings.data ?? []).flatMap(row => {
                const clientId = text(row.client_id);
                const organizationId = text(row.organization_id);
                return clientId && organizationId ? [{ clientId, organizationId }] : [];
            });
            if (opted.length === 0) return { ok: true, candidates: [] };
            const clientIds = opted.map(row => row.clientId);
            const [clients, contacts, shipped, openWork, waiting] = await Promise.all([
                rowsFor(async ids => await admin.from('clients').select('id, organization_id, name, account_manager_id').in('id', ids), clientIds),
                rowsFor(async ids => await admin.from('client_portal_contacts').select('id, client_id, organization_id, email').in('client_id', ids).is('revoked_at', null), clientIds),
                rowsFor(async ids => await admin.from('deliverables').select('client_id, organization_id, title, status, delivered_on, published_url').in('client_id', ids).eq('status', 'Published').gte('delivered_on', week.start).lte('delivered_on', week.end), clientIds),
                rowsFor(async ids => await admin.from('deliverables').select('client_id, organization_id, title, status, delivered_on, published_url').in('client_id', ids).in('status', ['In Progress', 'Review', 'Approved']), clientIds),
                rowsFor(async ids => await admin.from('client_portal_waiting_items').select('client_id, organization_id, title').in('client_id', ids).is('resolved_at', null), clientIds),
            ]);
            const failed = [clients, contacts, shipped, openWork, waiting].find(result => !result.ok);
            if (failed && !failed.ok) return { ok: false, unavailable: unavailable(failed.error) };
            if (!clients.ok || !contacts.ok || !shipped.ok || !openWork.ok || !waiting.ok) return { ok: false, unavailable: false };

            const orgIds = [...new Set(clients.rows.map(row => text(row.organization_id)).filter((id): id is string => Boolean(id)))];
            const managerIds = [...new Set(clients.rows.map(row => text(row.account_manager_id)).filter((id): id is string => Boolean(id)))];
            const [orgs, managers] = await Promise.all([
                orgIds.length === 0 ? Promise.resolve({ data: [], error: null }) : admin.from('organizations').select('id, name').in('id', orgIds),
                managerIds.length === 0 ? Promise.resolve({ data: [], error: null }) : admin.from('users').select('id, full_name, email').in('id', managerIds),
            ]);
            if (orgs.error || managers.error) return { ok: false, unavailable: unavailable(orgs.error ?? managers.error) };

            const orgName = new Map((orgs.data ?? []).map(row => [String(row.id), text(row.name) ?? '']));
            const managerById = new Map((managers.data ?? []).map(row => [String(row.id), row]));
            const allowed = new Map(opted.map(row => [`${row.organizationId}:${row.clientId}`, row]));

            return {
                ok: true,
                candidates: clients.rows.flatMap(row => {
                    const clientId = text(row.id);
                    const organizationId = text(row.organization_id);
                    if (!clientId || !organizationId || !allowed.has(`${organizationId}:${clientId}`)) return [];
                    const manager = managerById.get(text(row.account_manager_id) ?? '');
                    const deliverables: DigestDeliverable[] = [...shipped.rows, ...openWork.rows].flatMap(item => {
                        if (text(item.client_id) !== clientId || text(item.organization_id) !== organizationId) return [];
                        return [{
                            title: String(item.title ?? ''),
                            status: String(item.status ?? ''),
                            deliveredOn: text(item.delivered_on),
                            publishedUrl: text(item.published_url),
                        }];
                    });
                    return [{
                        organizationId,
                        clientId,
                        clientName: text(row.name) ?? 'Your business',
                        amName: text(manager?.full_name) ?? 'Your account manager',
                        amEmail: text(manager?.email),
                        agencyName: orgName.get(organizationId) || 'your agency',
                        contacts: contacts.rows.flatMap(contact => {
                            if (text(contact.client_id) !== clientId || text(contact.organization_id) !== organizationId) return [];
                            const id = text(contact.id);
                            const email = text(contact.email);
                            return id && email ? [{ id, email }] : [];
                        }),
                        deliverables,
                        waiting: waiting.rows.flatMap(item => {
                            if (text(item.client_id) !== clientId || text(item.organization_id) !== organizationId) return [];
                            return [{ title: String(item.title ?? '') }];
                        }),
                        optedIn: true,
                    }];
                }),
            };
        },
        async enqueue(input) {
            const inserted = await admin.from('client_portal_email_queue').insert({
                organization_id: input.organizationId,
                client_id: input.clientId,
                contact_id: input.contactId,
                event_kind: 'weekly_digest',
                event_id: input.eventId,
                next_path: '/portal',
            });
            if (inserted.error?.code === '23505') return 'duplicate';
            if (inserted.error) return 'unavailable';
            return 'ok';
        },
        async claim() {
            const claimed = await admin.rpc('claim_client_portal_emails', { p_limit: 50, p_kind: 'weekly_digest' });
            if (claimed.error) return { ok: false, unavailable: unavailable(claimed.error) };
            return {
                ok: true,
                jobs: ((claimed.data ?? []) as Record<string, unknown>[]).flatMap(row => {
                    const id = text(row.id);
                    const organizationId = text(row.organization_id);
                    const clientId = text(row.client_id);
                    const contactId = text(row.contact_id);
                    const eventId = text(row.event_id);
                    const createdAt = text(row.created_at);
                    if (!id || !organizationId || !clientId || !contactId || !eventId || !createdAt) return [];
                    if (row.event_kind !== 'weekly_digest') return [];
                    return [{
                        id,
                        organization_id: organizationId,
                        client_id: clientId,
                        contact_id: contactId,
                        event_id: eventId,
                        attempts: Number(row.attempts ?? 0),
                        created_at: createdAt,
                    }];
                }),
            };
        },
        async hydrate(job, week) {
            const [settings, contact, client, shipped, openWork, waiting] = await Promise.all([
                admin.from('client_portal_settings').select('weekly_digest').eq('client_id', job.client_id).eq('organization_id', job.organization_id).maybeSingle(),
                admin.from('client_portal_contacts').select('email').eq('id', job.contact_id).eq('client_id', job.client_id).eq('organization_id', job.organization_id).is('revoked_at', null).maybeSingle(),
                admin.from('clients').select('name, account_manager_id').eq('id', job.client_id).eq('organization_id', job.organization_id).maybeSingle(),
                admin.from('deliverables').select('title, status, delivered_on, published_url').eq('client_id', job.client_id).eq('organization_id', job.organization_id).eq('status', 'Published').gte('delivered_on', week.start).lte('delivered_on', week.end),
                admin.from('deliverables').select('title, status, delivered_on, published_url').eq('client_id', job.client_id).eq('organization_id', job.organization_id).in('status', ['In Progress', 'Review', 'Approved']),
                admin.from('client_portal_waiting_items').select('title').eq('client_id', job.client_id).eq('organization_id', job.organization_id).is('resolved_at', null),
            ]);
            const errors = [settings.error, contact.error, client.error, shipped.error, openWork.error, waiting.error].filter(Boolean);
            if (errors.length > 0) return { ok: false, missing: false, unavailable: errors.some(error => unavailable(error)) };
            if (!client.data) return { ok: false, missing: true, unavailable: false };
            const org = await admin.from('organizations').select('name').eq('id', job.organization_id).maybeSingle();
            if (org.error) return { ok: false, missing: false, unavailable: unavailable(org.error) };
            const managerId = text(client.data.account_manager_id);
            let amName = 'Your account manager';
            let amEmail: string | null = null;
            if (managerId) {
                const manager = await admin.from('users').select('full_name, email').eq('id', managerId).maybeSingle();
                if (manager.error) return { ok: false, missing: false, unavailable: unavailable(manager.error) };
                if (text(manager.data?.full_name)) amName = String(manager.data?.full_name);
                amEmail = text(manager.data?.email);
            }
            const deliverables: DigestDeliverable[] = [...(shipped.data ?? []), ...(openWork.data ?? [])].map(item => ({
                title: String(item.title ?? ''),
                status: String(item.status ?? ''),
                deliveredOn: text(item.delivered_on),
                publishedUrl: text(item.published_url),
            }));
            return {
                ok: true,
                to: text(contact.data?.email) ?? '',
                candidate: {
                    organizationId: job.organization_id,
                    clientId: job.client_id,
                    clientName: text(client.data.name) ?? 'Your business',
                    amName,
                    amEmail,
                    agencyName: text(org.data?.name) ?? 'your agency',
                    contacts: [],
                    deliverables,
                    waiting: (waiting.data ?? []).map(item => ({ title: String(item.title ?? '') })),
                    optedIn: settings.data?.weekly_digest === true,
                },
            };
        },
        async markSent(id) {
            const saved = await admin.from('client_portal_email_queue').update({ sent_at: new Date().toISOString() }).eq('id', id).eq('event_kind', 'weekly_digest');
            return !saved.error;
        },
        async cancel(id) {
            const saved = await admin.from('client_portal_email_queue').update({ canceled_at: new Date().toISOString() }).eq('id', id).eq('event_kind', 'weekly_digest');
            return !saved.error;
        },
        async release(job) {
            await admin.from('client_portal_email_queue').update({
                claimed_at: null,
                available_at: new Date(Date.now() + 15 * 60000 * Math.pow(2, Math.max(0, job.attempts - 1))).toISOString(),
                ...(job.attempts >= 6 ? { failed_at: new Date().toISOString() } : {}),
            }).eq('id', job.id).eq('event_kind', 'weekly_digest');
        },
    };
}

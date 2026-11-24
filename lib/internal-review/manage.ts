import { z } from 'zod';
import { uuid } from '@/lib/approvals-v2/list';
import { json, sqlStatus, staffContext } from '@/lib/approvals-v2/staff';
import { generateToken, hashToken } from '@/lib/approvals/token';
import { authenticateBotRequest, verifyBotKey } from '@/lib/bots/auth';
import { isSeoBot } from '@/lib/bots/keys';
import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { bearerToken, isBotKeyToken } from '@/lib/bots/scope';
import { createAdminClient } from '@/lib/supabase/admin';
import { RETRY_KEY_PATTERN } from './model';

const id = z.string().regex(uuid);
const expiresInDays = z.number().int().min(1).max(30).default(7);
const staffCreate = z.strictObject({ scope: z.enum(['request', 'client']), expiresInDays });
const botCreate = z.strictObject({
    requestId: id.optional(),
    clientId: id.optional(),
    idempotencyKey: z.string().regex(RETRY_KEY_PATTERN),
    expiresInDays,
}).refine(value => Boolean(value.requestId) !== Boolean(value.clientId));

type Admin = ReturnType<typeof createAdminClient>;

async function issue(request: Request, admin: Admin, command: {
    organizationId: string;
    actorId?: string;
    botKeyId?: string;
    requestId?: string;
    clientId?: string;
    expiresInDays: number;
    idempotencyKey?: string;
}) {
    const token = generateToken();
    const { data, error } = await admin.rpc('issue_approval_internal_link', {
        p_actor: command.actorId ?? null,
        p_bot_key_id: command.botKeyId ?? null,
        p_request_id: command.requestId ?? null,
        p_client_id: command.clientId ?? null,
        p_token_hash: hashToken(token),
        p_expires_in_days: command.expiresInDays,
        p_idempotency_key: command.idempotencyKey ?? null,
        p_organization_id: command.organizationId,
        p_now: new Date().toISOString(),
    });
    if (error || !data) return json({ error: 'The internal link could not be created.' }, 503);
    if (data.ok !== true) return json({ error: 'The internal link could not be created.', code: data.code }, sqlStatus(data.code));
    if (data.idempotent) return json({ expiresAt: data.expiresAt, idempotent: true });
    return json({
        url: new URL(`/ir/${token}`, request.url).href,
        expiresAt: data.expiresAt,
        ...(command.actorId ? { id: data.id } : {}),
    }, 201);
}

export function createStaffInternalLinks(method: 'GET' | 'POST' | 'DELETE', dependencies = { agencyActor, createAdminClient }) {
    return async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
        if (isBotKeyToken(bearerToken(request.headers.get('authorization')))) {
            return json({ error: 'Forbidden', code: 'forbidden' }, 403);
        }
        const ctx = await staffContext(request, dependencies);
        if (!ctx) return json({ error: 'Unauthorized', code: 'unauthorized' }, 401);
        if (ctx.unavailable) return json({ error: 'Memberships unavailable.' }, 503);

        const requestId = (await context.params).id;
        if (!uuid.test(requestId)) return json({ error: 'Invalid request ID.' }, 400);
        const notFound = () => json({ error: 'Not found.', code: 'not_found' }, 404);
        if (!ctx.members.length) return notFound();
        const { data: anchor, error } = await ctx.admin.from('approval_requests')
            .select('organization_id,client_id').eq('id', requestId).eq('item_type', 'gbp_post')
            .in('organization_id', ctx.members.map(member => member.organization_id)).maybeSingle();
        if (error) return json({ error: 'The approval request could not be loaded.' }, 503);
        if (!anchor) return notFound();
        const role = ctx.members.find(member => member.organization_id === anchor.organization_id)?.role;
        if (!['owner', 'admin', 'member'].includes(role ?? '')) {
            return json({ error: 'Forbidden', code: 'forbidden' }, 403);
        }

        if (method === 'POST') {
            const parsed = staffCreate.safeParse(await request.json().catch(() => null));
            if (!parsed.success) return json({ error: 'Choose a scope and an expiry between 1 and 30 days.' }, 400);
            return issue(request, ctx.admin, {
                organizationId: anchor.organization_id,
                actorId: ctx.actor,
                requestId,
                clientId: parsed.data.scope === 'client' ? anchor.client_id : undefined,
                expiresInDays: parsed.data.expiresInDays,
            });
        }

        const now = new Date().toISOString();
        const scopeFilter = `scope.eq.client,request_id.eq.${requestId}`;
        if (method === 'GET') {
            const { data, error } = await ctx.admin.from('approval_internal_links')
                .select('id,scope,expires_at')
                .eq('organization_id', anchor.organization_id).eq('client_id', anchor.client_id)
                .or(scopeFilter).is('revoked_at', null).gt('expires_at', now)
                .order('created_at', { ascending: false });
            if (error) return json({ error: 'Internal links could not be loaded.' }, 503);
            return json({ links: data.map(link => ({ id: link.id, scope: link.scope, expiresAt: link.expires_at })) });
        }

        const parsed = z.strictObject({ linkId: id }).safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: 'Choose an internal link.' }, 400);
        const { data, error: revokeError } = await ctx.admin.from('approval_internal_links')
            .update({ revoked_at: now, revoked_by: ctx.actor })
            .eq('id', parsed.data.linkId).eq('organization_id', anchor.organization_id).eq('client_id', anchor.client_id)
            .or(scopeFilter).is('revoked_at', null).select('id').maybeSingle();
        if (revokeError) return json({ error: 'The internal link could not be revoked.' }, 503);
        return data ? json({ ok: true }) : notFound();
    };
}

export function createBotInternalLink(admin = createAdminClient) {
    return async function POST(request: Request) {
        const auth = await authenticateBotRequest(request, token => verifyBotKey(token, admin));
        if ('response' in auth) return auth.response;
        if (!isSeoBot(auth.key.name)) return json({ error: 'This key cannot create internal review links.', code: 'forbidden' }, 403);
        const parsed = botCreate.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
            return json({ error: 'Send one requestId or clientId, an idempotencyKey, and an optional expiry between 1 and 30 days.' }, 400);
        }
        return issue(request, admin(), { ...parsed.data, organizationId: auth.key.organizationId, botKeyId: auth.key.id });
    };
}

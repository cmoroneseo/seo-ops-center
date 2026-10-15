import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrganizationAdmin } from '@/lib/security/tenant-authz';
import type { BotScope } from './auth';
import { issueBotTokenAction, listBotTokensAction, revokeBotTokenAction, type SettingsDeps } from './settings-action';
import type { BotTokenView } from './settings';

export async function listBotTokens(request: Request): Promise<Response> {
    const organizationId = new URL(request.url).searchParams.get('organizationId') ?? '';
    return listBotTokensAction(organizationId, productionSettingsDeps());
}

export async function issueBotToken(request: Request): Promise<Response> {
    const body = await readJson(request);
    return issueBotTokenAction(body, productionSettingsDeps());
}

export async function revokeBotToken(request: Request): Promise<Response> {
    const body = await readJson(request);
    return revokeBotTokenAction(body, productionSettingsDeps());
}

function productionSettingsDeps(): SettingsDeps {
    const admin = createAdminClient();
    return {
        now: () => new Date(),
        async authorize(organizationId) {
            const actor = await requireOrganizationAdmin(organizationId);
            if (!actor.ok) return actor;
            return { ok: true, userId: actor.userId, organizationId: actor.organizationId };
        },
        async clientsInOrg(organizationId, clientIds) {
            const { data, error } = await admin
                .from('clients')
                .select('id')
                .eq('organization_id', organizationId)
                .in('id', clientIds);
            if (error) return false;
            return (data ?? []).length === clientIds.length;
        },
        async insertToken(row) {
            const { data, error } = await admin.from('bot_tokens').insert({
                organization_id: row.organizationId,
                name: row.name,
                token_prefix: row.prefix,
                token_hash: row.hash,
                scopes: row.scopes,
                client_ids: row.clientIds,
                expires_at: row.expiresAt,
                rate_limit_per_minute: row.rateLimitPerMinute,
                created_by: row.createdBy,
            }).select('id, name, token_prefix, scopes, client_ids, expires_at, revoked_at, last_used_at, rate_limit_per_minute, created_at').single();
            if (error || !data) throw new Error('Unable to issue bot token');
            return viewFromRow(data);
        },
        async listTokens(organizationId) {
            const { data, error } = await admin
                .from('bot_tokens')
                .select('id, name, token_prefix, scopes, client_ids, expires_at, revoked_at, last_used_at, rate_limit_per_minute, created_at')
                .eq('organization_id', organizationId)
                .order('created_at', { ascending: false })
                .limit(200);
            if (error) throw new Error('Unable to list bot tokens');
            return (data ?? []).map(viewFromRow);
        },
        async revokeToken(organizationId, tokenId, now) {
            const { data, error } = await admin
                .from('bot_tokens')
                .update({ revoked_at: now.toISOString() })
                .eq('id', tokenId)
                .eq('organization_id', organizationId)
                .is('revoked_at', null)
                .select('id, name, token_prefix, scopes, client_ids, expires_at, revoked_at, last_used_at, rate_limit_per_minute, created_at')
                .maybeSingle();
            if (error) throw new Error('Unable to revoke bot token');
            if (data) return viewFromRow(data);
            const existing = await admin
                .from('bot_tokens')
                .select('id, name, token_prefix, scopes, client_ids, expires_at, revoked_at, last_used_at, rate_limit_per_minute, created_at')
                .eq('id', tokenId)
                .eq('organization_id', organizationId)
                .maybeSingle();
            if (existing.error || !existing.data) return null;
            return viewFromRow(existing.data);
        },
    };
}

function viewFromRow(row: Record<string, unknown>): BotTokenView {
    return {
        id: String(row.id),
        name: String(row.name),
        prefix: String(row.token_prefix),
        scopes: Array.isArray(row.scopes) ? row.scopes.filter((scope: unknown): scope is BotScope => scope === 'ga4.read' || scope === 'gsc.read') : [],
        clientIds: Array.isArray(row.client_ids) ? row.client_ids.filter((id: unknown): id is string => typeof id === 'string') : [],
        expiresAt: typeof row.expires_at === 'string' ? row.expires_at : null,
        revokedAt: typeof row.revoked_at === 'string' ? row.revoked_at : null,
        lastUsedAt: typeof row.last_used_at === 'string' ? row.last_used_at : null,
        rateLimitPerMinute: Number(row.rate_limit_per_minute),
        createdAt: String(row.created_at),
    };
}

async function readJson(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

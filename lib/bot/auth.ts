import { botTokenMatchesOrDummy, parseBotToken, readBearerToken } from './token';

export const BOT_SCOPES = ['ga4.read', 'gsc.read'] as const;
export type BotScope = (typeof BOT_SCOPES)[number];

export interface BotTokenRecord {
    id: string;
    organizationId: string;
    tokenHash: string;
    scopes: readonly string[];
    clientIds: readonly string[];
    expiresAt: string | null;
    revokedAt: string | null;
    rateLimitPerMinute: number;
}

export type BotAuthDenial = 'invalid_token' | 'expired' | 'revoked' | 'insufficient_scope';

export type BotAuthDecision =
    | {
        ok: true;
        tokenId: string;
        organizationId: string;
        prefix: string;
        scopes: BotScope[];
        clientIds: string[];
        rateLimitPerMinute: number;
    }
    | {
        ok: false;
        code: BotAuthDenial;
        status: 401 | 403;
        prefix: string | null;
        tokenId: string | null;
        organizationId: string | null;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Authenticates one bearer token. `record` is the row looked up by prefix,
 * or null when the prefix is unknown. The hash compare still runs on a miss.
 */
export function authorizeBotToken(input: {
    authorizationHeader: string | null;
    record: BotTokenRecord | null;
    now: Date;
    scope: BotScope;
}): BotAuthDecision {
    const presented = readBearerToken(input.authorizationHeader);
    const parsed = presented ? parseBotToken(presented) : null;
    const prefix = parsed?.prefix ?? null;
    const matches = presented ? botTokenMatchesOrDummy(presented, input.record?.tokenHash ?? null) : false;

    if (!parsed || !input.record || !matches) {
        return { ok: false, code: 'invalid_token', status: 401, prefix, tokenId: null, organizationId: null };
    }

    const record = input.record;
    if (record.revokedAt) {
        return { ok: false, code: 'revoked', status: 401, prefix, tokenId: record.id, organizationId: record.organizationId };
    }
    if (record.expiresAt && Date.parse(record.expiresAt) <= input.now.getTime()) {
        return { ok: false, code: 'expired', status: 401, prefix, tokenId: record.id, organizationId: record.organizationId };
    }

    const scopes = record.scopes.filter((scope): scope is BotScope => scope === 'ga4.read' || scope === 'gsc.read');
    if (!scopes.includes(input.scope)) {
        return { ok: false, code: 'insufficient_scope', status: 403, prefix, tokenId: record.id, organizationId: record.organizationId };
    }

    const clientIds = record.clientIds.filter(id => UUID.test(id));
    if (clientIds.length !== record.clientIds.length) {
        return { ok: false, code: 'invalid_token', status: 401, prefix, tokenId: record.id, organizationId: record.organizationId };
    }

    const limit = record.rateLimitPerMinute;
    if (!Number.isInteger(limit) || limit < 1 || limit > 600) {
        return { ok: false, code: 'invalid_token', status: 401, prefix, tokenId: record.id, organizationId: record.organizationId };
    }

    return {
        ok: true,
        tokenId: record.id,
        organizationId: record.organizationId,
        prefix: parsed.prefix,
        scopes,
        clientIds,
        rateLimitPerMinute: limit,
    };
}

/** Empty allowlist means every client in the token's organization. */
export function clientAllowed(clientIds: readonly string[], clientId: string): boolean {
    return clientIds.length === 0 || clientIds.includes(clientId);
}

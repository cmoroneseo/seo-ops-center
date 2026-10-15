import { z } from 'zod';
import { BOT_SCOPES, type BotScope } from './auth';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EXPIRY_MS = 366 * 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;

const issueShape = z.object({
    organizationId: z.string(),
    name: z.string(),
    scopes: z.array(z.enum(BOT_SCOPES)).optional(),
    clientIds: z.array(z.string()).optional(),
    expiresAt: z.union([z.string(), z.null()]).optional(),
    rateLimitPerMinute: z.number().int().optional(),
}).strict();

const revokeShape = z.object({
    organizationId: z.string(),
    tokenId: z.string(),
}).strict();

export interface BotTokenView {
    id: string;
    name: string;
    prefix: string;
    scopes: BotScope[];
    clientIds: string[];
    expiresAt: string | null;
    revokedAt: string | null;
    lastUsedAt: string | null;
    rateLimitPerMinute: number;
    createdAt: string;
}

export interface IssueInput {
    organizationId: string;
    name: string;
    scopes: BotScope[];
    clientIds: string[];
    expiresAt: string | null;
    rateLimitPerMinute: number;
}

export function parseIssueInput(body: unknown, now: Date): { ok: true; value: IssueInput } | { ok: false; error: string } {
    const parsed = issueShape.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'Invalid token request' };
    if (!UUID.test(parsed.data.organizationId)) return { ok: false, error: 'Invalid token request' };
    const name = parsed.data.name.trim();
    if (name.length < 1 || name.length > 80 || /[\u0000-\u001f]/.test(name)) {
        return { ok: false, error: 'Invalid token request' };
    }
    const scopes = parsed.data.scopes && parsed.data.scopes.length > 0 ? [...new Set(parsed.data.scopes)] : [...BOT_SCOPES];
    const clientIds = parsed.data.clientIds ?? [];
    if (clientIds.length > 100 || clientIds.some(id => !UUID.test(id)) || new Set(clientIds).size !== clientIds.length) {
        return { ok: false, error: 'Invalid token request' };
    }
    const rate = parsed.data.rateLimitPerMinute ?? 60;
    if (rate < 1 || rate > 600) return { ok: false, error: 'Invalid token request' };

    let expiresAt: string | null;
    if (parsed.data.expiresAt === null) {
        expiresAt = null;
    } else if (parsed.data.expiresAt === undefined) {
        expiresAt = new Date(now.getTime() + DEFAULT_EXPIRY_MS).toISOString();
    } else {
        const time = Date.parse(parsed.data.expiresAt);
        if (!Number.isFinite(time) || time <= now.getTime() || time > now.getTime() + MAX_EXPIRY_MS) {
            return { ok: false, error: 'Invalid token request' };
        }
        expiresAt = new Date(time).toISOString();
    }

    return {
        ok: true,
        value: {
            organizationId: parsed.data.organizationId,
            name,
            scopes,
            clientIds,
            expiresAt,
            rateLimitPerMinute: rate,
        },
    };
}

export function parseRevokeInput(body: unknown): { ok: true; organizationId: string; tokenId: string } | { ok: false; error: string } {
    const parsed = revokeShape.safeParse(body);
    if (!parsed.success || !UUID.test(parsed.data.organizationId) || !UUID.test(parsed.data.tokenId)) {
        return { ok: false, error: 'Invalid token request' };
    }
    return { ok: true, organizationId: parsed.data.organizationId, tokenId: parsed.data.tokenId };
}

/** List responses must not grow a plaintext field later by accident. */
export function toBotTokenView(row: BotTokenView): BotTokenView {
    return {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        scopes: row.scopes,
        clientIds: row.clientIds,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        lastUsedAt: row.lastUsedAt,
        rateLimitPerMinute: row.rateLimitPerMinute,
        createdAt: row.createdAt,
    };
}

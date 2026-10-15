import { parseIssueInput, parseRevokeInput, toBotTokenView, type BotTokenView } from './settings';
import { generateBotToken } from './token';

export interface SettingsActor {
    ok: true;
    userId: string;
    organizationId: string;
}

export interface SettingsDeps {
    now: () => Date;
    authorize: (organizationId: string) => Promise<SettingsActor | { ok: false; status: number; error: string }>;
    clientsInOrg: (organizationId: string, clientIds: string[]) => Promise<boolean>;
    insertToken: (row: {
        organizationId: string;
        name: string;
        prefix: string;
        hash: string;
        scopes: string[];
        clientIds: string[];
        expiresAt: string | null;
        rateLimitPerMinute: number;
        createdBy: string;
    }) => Promise<BotTokenView>;
    listTokens: (organizationId: string) => Promise<BotTokenView[]>;
    revokeToken: (organizationId: string, tokenId: string, now: Date) => Promise<BotTokenView | null>;
}

export async function listBotTokensAction(organizationId: string, deps: SettingsDeps): Promise<Response> {
    const actor = await deps.authorize(organizationId);
    if (!actor.ok) return json({ error: actor.error }, actor.status);
    const tokens = (await deps.listTokens(actor.organizationId)).map(toBotTokenView);
    return json({ tokens }, 200);
}

export async function issueBotTokenAction(body: unknown, deps: SettingsDeps): Promise<Response> {
    const now = deps.now();
    const parsed = parseIssueInput(body, now);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const actor = await deps.authorize(parsed.value.organizationId);
    if (!actor.ok) return json({ error: actor.error }, actor.status);
    if (parsed.value.clientIds.length > 0) {
        const allowed = await deps.clientsInOrg(actor.organizationId, parsed.value.clientIds);
        if (!allowed) return json({ error: 'Invalid token request' }, 400);
    }
    const material = generateBotToken();
    const created = await deps.insertToken({
        organizationId: actor.organizationId,
        name: parsed.value.name,
        prefix: material.prefix,
        hash: material.hash,
        scopes: parsed.value.scopes,
        clientIds: parsed.value.clientIds,
        expiresAt: parsed.value.expiresAt,
        rateLimitPerMinute: parsed.value.rateLimitPerMinute,
        createdBy: actor.userId,
    });
    return json({ token: material.token, bot: toBotTokenView(created) }, 201);
}

export async function revokeBotTokenAction(body: unknown, deps: SettingsDeps): Promise<Response> {
    const parsed = parseRevokeInput(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const actor = await deps.authorize(parsed.organizationId);
    if (!actor.ok) return json({ error: actor.error }, actor.status);
    const revoked = await deps.revokeToken(actor.organizationId, parsed.tokenId, deps.now());
    if (!revoked) return json({ error: 'Token not found' }, 404);
    return json({ token: toBotTokenView(revoked) }, 200);
}

function json(payload: unknown, status: number): Response {
    return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

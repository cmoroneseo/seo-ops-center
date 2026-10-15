import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { issueBotTokenAction, listBotTokensAction, revokeBotTokenAction, type SettingsDeps } from './settings-action';
import { hashBotToken } from './token';
import { isBotApiPath } from './paths';

const ORG = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-15T00:00:00.000Z');

function harness() {
    const inserted: Array<Record<string, unknown>> = [];
    const tokens = new Map<string, Record<string, unknown>>();
    const deps: SettingsDeps = {
        now: () => NOW,
        async authorize(organizationId) {
            if (organizationId !== ORG) return { ok: false, status: 403, error: 'Forbidden' };
            return { ok: true, userId: '11111111-1111-4111-8111-111111111111', organizationId: ORG };
        },
        async clientsInOrg(_organizationId, clientIds) {
            return clientIds.every(id => id === CLIENT);
        },
        async insertToken(row) {
            inserted.push(row);
            const view = {
                id: '55555555-5555-4555-8555-555555555555',
                name: row.name,
                prefix: row.prefix,
                scopes: row.scopes,
                clientIds: row.clientIds,
                expiresAt: row.expiresAt,
                revokedAt: null,
                lastUsedAt: null,
                rateLimitPerMinute: row.rateLimitPerMinute,
                createdAt: NOW.toISOString(),
            };
            tokens.set(view.id, view);
            return view as never;
        },
        async listTokens() {
            return [...tokens.values()] as never;
        },
        async revokeToken(organizationId, tokenId) {
            if (organizationId !== ORG) return null;
            const view = tokens.get(tokenId);
            if (!view) return null;
            view.revokedAt = NOW.toISOString();
            return view as never;
        },
    };
    return { deps, inserted, tokens };
}

test('issue stores only the hash and list does not return the plaintext', async () => {
    const { deps, inserted } = harness();
    const created = await issueBotTokenAction({
        organizationId: ORG,
        name: 'Weekly digest',
        clientIds: [CLIENT],
        rateLimitPerMinute: 30,
    }, deps);
    const body = await created.json();
    assert.equal(created.status, 201);
    assert.equal(typeof body.token, 'string');
    assert.equal(body.token.startsWith(`socbot_${body.bot.prefix}_`), true);
    assert.equal(inserted[0].hash, hashBotToken(body.token));
    assert.equal(JSON.stringify(inserted).includes(body.token), false);
    assert.equal(body.bot.token, undefined);
    const listed = await listBotTokensAction(ORG, deps);
    const listBody = await listed.json();
    assert.equal(JSON.stringify(listBody).includes(body.token), false);
    assert.equal(listBody.tokens[0].prefix, body.bot.prefix);
});

test('revoke is organization scoped and a foreign client is rejected', async () => {
    const { deps } = harness();
    const created = await issueBotTokenAction({ organizationId: ORG, name: 'Reader' }, deps);
    const body = await created.json();
    const missing = await revokeBotTokenAction({ organizationId: '66666666-6666-4666-8666-666666666666', tokenId: body.bot.id }, deps);
    assert.equal(missing.status, 403);
    const revoked = await revokeBotTokenAction({ organizationId: ORG, tokenId: body.bot.id }, deps);
    assert.equal(revoked.status, 200);
    const again = await revokeBotTokenAction({ organizationId: ORG, tokenId: body.bot.id }, deps);
    assert.equal(again.status, 200);
    const foreign = await issueBotTokenAction({
        organizationId: ORG,
        name: 'Nope',
        clientIds: ['77777777-7777-4777-8777-777777777777'],
    }, deps);
    assert.equal(foreign.status, 400);
});

test('bot routes skip the session middleware and settings is owner or admin only', () => {
    assert.equal(isBotApiPath('/api/bot/ga4'), true);
    assert.equal(isBotApiPath('/api/bot/gsc'), true);
    assert.equal(isBotApiPath('/api/bot/ga4/extra'), false);
    const middleware = readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8');
    const settings = readFileSync(new URL('../../app/(dashboard)/settings/page.tsx', import.meta.url), 'utf8');
    const tab = readFileSync(new URL('../../components/settings/BotTokensTab.tsx', import.meta.url), 'utf8');
    const properties = readFileSync(new URL('../../app/api/integrations/google/properties/route.ts', import.meta.url), 'utf8');
    const gsc = readFileSync(new URL('../../app/api/integrations/google/gsc/route.ts', import.meta.url), 'utf8');
    const configure = readFileSync(new URL('../../app/api/integrations/google/configure/route.ts', import.meta.url), 'utf8');
    const integrations = readFileSync(new URL('../supabase/integrations.ts', import.meta.url), 'utf8');
    assert.match(middleware, /isBotApiPath\(request\.nextUrl\.pathname\)/);
    assert.match(settings, /canManageBots = role === 'owner' \|\| role === 'admin'/);
    assert.match(settings, /<BotTokensTab/);
    assert.match(tab, /It will not be shown again/);
    assert.match(tab, /Revoke/);
    assert.equal(tab.includes('token_hash'), false);
    assert.match(properties, /getGoogleAccessToken/);
    assert.equal(properties.includes('oauth2.googleapis.com'), false);
    assert.match(gsc, /sealCredentialSecrets/);
    assert.match(configure, /sealCredentialSecrets/);
    assert.match(integrations, /sealCredentialSecrets/);
});

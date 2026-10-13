import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeVaultClient, type VaultAccessDeps } from './access.ts';
import { VAULT_SANDBOX_ORG_ID } from './flags.ts';

const clientId = 'cbba5b14-7e24-4913-b396-0fff7fb2df17';
const env = { VAULT_ENABLED: 'true', VAULT_ORG_IDS: VAULT_SANDBOX_ORG_ID } as NodeJS.ProcessEnv;

function deps(overrides: Partial<VaultAccessDeps> = {}): VaultAccessDeps & { memberCalls: number } {
    const state = { memberCalls: 0 };
    return {
        memberCalls: state.memberCalls,
        lookupClient: async () => ({ organizationId: VAULT_SANDBOX_ORG_ID }),
        requireMember: async () => {
            state.memberCalls += 1;
            return {
                ok: true,
                userId: 'user-1',
                actorName: 'Ada',
                organizationId: VAULT_SANDBOX_ORG_ID,
                clientId,
                role: 'viewer' as const,
            };
        },
        isPortalContact: async () => false,
        env,
        get memberCalls() { return state.memberCalls; },
        ...overrides,
    };
}

test('the vault API is not found when the flag is off, before membership is checked', async () => {
    let memberCalls = 0;
    const result = await authorizeVaultClient(clientId, deps({
        env: {} as NodeJS.ProcessEnv,
        requireMember: async () => {
            memberCalls += 1;
            return { ok: false, status: 401, error: 'Unauthorized' };
        },
    }));
    assert.deepEqual(result, { ok: false, status: 404, error: 'Not found' });
    assert.equal(memberCalls, 0);
});

test('another organization and a portal contact are not found; viewers still read', async () => {
    const missing = await authorizeVaultClient(clientId, deps({
        requireMember: async () => ({ ok: false, status: 403, error: 'Forbidden' }),
    }));
    assert.equal(missing.status, 404);
    const portal = await authorizeVaultClient(clientId, deps({ isPortalContact: async () => true }));
    assert.equal(portal.status, 404);
    const viewer = await authorizeVaultClient(clientId, deps());
    assert.equal(viewer.ok, true);
    if (viewer.ok) assert.equal(viewer.role, 'viewer');
    const unknown = await authorizeVaultClient('not-a-client', deps());
    assert.equal(unknown.status, 404);
});

test('an unsigned request is unauthorized only when the vault is enabled', async () => {
    const result = await authorizeVaultClient(clientId, deps({
        requireMember: async () => ({ ok: false, status: 401, error: 'Unauthorized' }),
    }));
    assert.equal(result.status, 401);
});

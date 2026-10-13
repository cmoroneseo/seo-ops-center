import test from 'node:test';
import assert from 'node:assert/strict';
import { VAULT_SANDBOX_ORG_ID, vaultEnabled } from './flags.ts';

const OTHER = '11111111-1111-4111-8111-111111111111';

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
    return values as NodeJS.ProcessEnv;
}

test('the vault stays off unless the flag is exactly true and the org is allowlisted', () => {
    assert.equal(vaultEnabled(env({}), VAULT_SANDBOX_ORG_ID), false);
    assert.equal(vaultEnabled(env({ VAULT_ENABLED: '1' }), VAULT_SANDBOX_ORG_ID), false);
    assert.equal(vaultEnabled(env({ VAULT_ENABLED: 'TRUE', VAULT_ORG_IDS: VAULT_SANDBOX_ORG_ID }), VAULT_SANDBOX_ORG_ID), false);
    assert.equal(vaultEnabled(env({ VAULT_ENABLED: 'true' }), VAULT_SANDBOX_ORG_ID), false);
    assert.equal(vaultEnabled(env({ VAULT_ENABLED: 'true', VAULT_ORG_IDS: '' }), VAULT_SANDBOX_ORG_ID), false);
    assert.equal(vaultEnabled(env({ VAULT_ENABLED: 'true', VAULT_ORG_IDS: 'nope' }), VAULT_SANDBOX_ORG_ID), false);
    assert.equal(vaultEnabled(env({
        VAULT_ENABLED: 'true',
        VAULT_ORG_IDS: ` ${VAULT_SANDBOX_ORG_ID.toUpperCase()} , not-a-uuid `,
    }), VAULT_SANDBOX_ORG_ID), true);
    assert.equal(vaultEnabled(env({
        VAULT_ENABLED: 'true',
        VAULT_ORG_IDS: VAULT_SANDBOX_ORG_ID,
    }), OTHER), false);
    assert.equal(vaultEnabled(env({
        VAULT_ENABLED: 'true',
        VAULT_ORG_IDS: VAULT_SANDBOX_ORG_ID,
    })), false);
});

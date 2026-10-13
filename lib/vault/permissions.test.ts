import test from 'node:test';
import assert from 'node:assert/strict';
import { canAdministerVault, canProposeVault, canReadVault, formatVaultCount, vaultEmptyState, vaultWriteLabel } from './permissions.ts';

test('admins operate, members propose, viewers only read', () => {
    for (const role of ['owner', 'admin'] as const) {
        assert.equal(canReadVault(role), true);
        assert.equal(canAdministerVault(role), true);
        assert.equal(canProposeVault(role), true);
        assert.equal(vaultWriteLabel(role), 'Save to vault');
        assert.equal(vaultEmptyState(role).action, 'Save to vault');
    }
    assert.equal(canAdministerVault('member'), false);
    assert.equal(canProposeVault('member'), true);
    assert.equal(vaultWriteLabel('member'), 'Propose to vault');
    assert.equal(vaultEmptyState('member').action, 'Propose to vault');
    assert.equal(canReadVault('viewer'), true);
    assert.equal(canProposeVault('viewer'), false);
    assert.equal(vaultWriteLabel('viewer'), null);
    assert.equal(vaultEmptyState('viewer').action, null);
});

test('counts stay an em dash until a real number arrives', () => {
    assert.equal(formatVaultCount(null), '—');
    assert.equal(formatVaultCount(undefined), '—');
    assert.equal(formatVaultCount(Number.NaN), '—');
    assert.equal(formatVaultCount(-1), '—');
    assert.equal(formatVaultCount(1.5), '—');
    assert.equal(formatVaultCount(0), '0');
    assert.equal(formatVaultCount(12), '12');
    assert.notEqual(formatVaultCount(null), '0');
});

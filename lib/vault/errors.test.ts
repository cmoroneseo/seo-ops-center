import test from 'node:test';
import assert from 'node:assert/strict';
import { vaultRpcFailure, vaultRpcStatus } from './errors.ts';

test('concurrent supersede and unique violations are conflicts', () => {
    assert.equal(vaultRpcStatus({ code: '40001', message: 'Vault entry changed concurrently' }), 409);
    assert.equal(vaultRpcStatus({ code: '23505', message: 'duplicate key value violates unique constraint "client_vault_entries_one_active_idx"' }), 409);
    assert.equal(vaultRpcFailure({ code: '40001', message: 'Vault entry changed concurrently' }).error, 'This vault entry changed. Reload it and try again.');
});

test('missing rows are 404 and role failures are 403', () => {
    assert.equal(vaultRpcStatus({ code: 'P0002', message: 'Vault entry not found' }), 404);
    assert.equal(vaultRpcStatus({ code: '42501', message: 'Only owners and admins can change the vault' }), 403);
    assert.equal(vaultRpcStatus({ code: '42501', message: 'Viewers cannot propose vault entries' }), 403);
    assert.equal(vaultRpcStatus({ code: '42501', message: 'Portal contacts cannot access the vault' }), 403);
    assert.equal(vaultRpcFailure({ code: '42501', message: 'Portal contacts cannot access the vault' }).error, 'Forbidden');
});

test('validation messages stay specific and unknown failures do not leak', () => {
    assert.equal(vaultRpcFailure({ code: '23514', message: 'Review date must be on or after the effective date' }).error, 'Review date must be on or after the effective date');
    assert.equal(vaultRpcFailure({ code: 'XX000', message: 'password=secret syntax error at line 1' }).status, 500);
    assert.equal(vaultRpcFailure({ code: 'XX000', message: 'password=secret syntax error at line 1' }).error, 'Vault request failed');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { vaultCommands } from './commands.ts';

const clientId = 'cbba5b14-7e24-4913-b396-0fff7fb2df17';

test('command items disappear when the vault flag is off or there is no client', () => {
    assert.deepEqual(vaultCommands({ enabled: false, clientId, role: 'admin' }), []);
    assert.deepEqual(vaultCommands({ enabled: null, clientId, role: 'admin' }), []);
    assert.deepEqual(vaultCommands({ enabled: true, clientId: null, role: 'admin' }), []);
});

test('admins, members, and viewers get role-specific vault commands', () => {
    const admin = vaultCommands({ enabled: true, clientId, role: 'admin' }).map(item => item.label);
    assert.deepEqual(admin, ['Open Context Vault', 'Save to vault', 'Review vault proposals']);
    const member = vaultCommands({ enabled: true, clientId, role: 'member' }).map(item => item.label);
    assert.deepEqual(member, ['Open Context Vault', 'Propose to vault']);
    const viewer = vaultCommands({ enabled: true, clientId, role: 'viewer' }).map(item => item.label);
    assert.deepEqual(viewer, ['Open Context Vault']);
});

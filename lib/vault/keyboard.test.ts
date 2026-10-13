import test from 'node:test';
import assert from 'node:assert/strict';
import { moveVaultSelection } from './keyboard.ts';

test('arrow keys, j and k, home, end, enter, escape, and slash move through the vault', () => {
    assert.equal(moveVaultSelection(-1, 3, 'ArrowDown'), 0);
    assert.equal(moveVaultSelection(0, 3, 'j'), 1);
    assert.equal(moveVaultSelection(2, 3, 'ArrowDown'), 2);
    assert.equal(moveVaultSelection(1, 3, 'k'), 0);
    assert.equal(moveVaultSelection(0, 3, 'ArrowUp'), 0);
    assert.equal(moveVaultSelection(1, 0, 'j'), null);
    assert.equal(moveVaultSelection(0, 3, 'Home'), 0);
    assert.equal(moveVaultSelection(0, 3, 'End'), 2);
    assert.equal(moveVaultSelection(1, 3, 'Enter'), 'open');
    assert.equal(moveVaultSelection(-1, 3, 'Enter'), null);
    assert.equal(moveVaultSelection(0, 3, 'Escape'), 'close');
    assert.equal(moveVaultSelection(0, 3, '/'), 'search');
    assert.equal(moveVaultSelection(0, 3, 'j', true), null);
    assert.equal(moveVaultSelection(0, 3, '/', true), null);
});

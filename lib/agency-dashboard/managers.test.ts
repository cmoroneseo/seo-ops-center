import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardManagerLabel } from './managers.ts';

const abel = { id: 'abel', name: 'Abel Miranda', email: 'amiranda@marketingempiregroup.com' };
const carlos = { id: 'carlos', name: 'Carlos Morones', email: 'cmorones@marketingempiregroup.com' };

test('short stored names collapse onto the one matching member', () => {
    assert.equal(dashboardManagerLabel('Abel', null, [abel, carlos]), 'Abel Miranda');
    assert.equal(dashboardManagerLabel('Carlos', carlos.id, [abel, carlos]), 'Carlos Morones');
    assert.equal(dashboardManagerLabel('Carlos Morones', carlos.id, [abel, carlos]), 'Carlos Morones');
    assert.equal(dashboardManagerLabel('  Abel Miranda  ', abel.id, [abel, carlos]), 'Abel Miranda');
});

test('an ambiguous short name and a missing member stay as stored', () => {
    const other = { id: 'other', name: 'Abel Other' };
    assert.equal(dashboardManagerLabel('Abel', null, [abel, other, carlos]), 'Abel');
    assert.equal(dashboardManagerLabel('Carlos', null, [abel]), 'Carlos');
    assert.equal(dashboardManagerLabel('  ', null, [abel]), null);
});

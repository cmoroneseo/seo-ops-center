import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyVaultInput, validateVaultInput } from './validate.ts';
import type { VaultEntryInput } from './types.ts';

function input(overrides: Partial<VaultEntryInput> = {}): VaultEntryInput {
    return {
        ...emptyVaultInput(),
        title: 'Keep the canonical URL',
        body: 'Do not change the homepage canonical during the redesign.',
        effectiveOn: '2026-10-01',
        ...overrides,
    };
}

test('a decision with a verbatim quote is accepted', () => {
    assert.equal(validateVaultInput(input({
        quote: 'Please keep the em dash — exactly.',
        sourceKind: 'meeting',
        sourceRef: 'notes/oct',
    })), null);
});

test('rules require a kind and block or warn, and other types cannot carry enforcement', () => {
    assert.match(validateVaultInput(input({ entryType: 'rule' })) ?? '', /Rule kind/);
    assert.match(validateVaultInput(input({ entryType: 'rule', ruleKind: 'content' })) ?? '', /block or warn/);
    assert.equal(validateVaultInput(input({
        entryType: 'rule',
        ruleKind: 'content',
        enforcement: 'block',
        ruleDetails: { statement: 'No doorway pages.' },
    })), null);
    assert.match(validateVaultInput(input({ enforcement: 'warn' })) ?? '', /Only rules/);
});

test('contacts need a name and dates must be real and ordered', () => {
    assert.match(validateVaultInput(input({ entryType: 'contact' })) ?? '', /Contact name/);
    assert.equal(validateVaultInput(input({
        entryType: 'contact',
        contactDetails: { name: 'Priya Shah', email: 'priya@client.test' },
    })), null);
    assert.match(validateVaultInput(input({ effectiveOn: '2026-02-31' })) ?? '', /Effective date/);
    assert.match(validateVaultInput(input({ reviewOn: '2026-09-01' })) ?? '', /on or after/);
    assert.match(validateVaultInput(input({ quote: '  ' })) ?? '', /Quote/);
    assert.match(validateVaultInput(input({ quote: 'Said on the call.' })) ?? '', /source kind/);
    assert.match(validateVaultInput(input({ appliesTo: ['Not A Slug'] })) ?? '', /short slugs/);
});

test('member_proposal is a stored source kind, not a composer choice', () => {
    assert.match(validateVaultInput(input({ quote: 'From the account manager.', sourceKind: 'member_proposal' })) ?? '', /Source kind/);
    assert.equal(validateVaultInput(input({ quote: 'From the account manager.', sourceKind: 'member_proposal' }), { allowMemberProposal: true }), null);
});

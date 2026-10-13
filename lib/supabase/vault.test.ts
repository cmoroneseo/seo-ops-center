import test from 'node:test';
import assert from 'node:assert/strict';
import { payloadToInput, rowToVaultCounts, rowToVaultDetail, rowToVaultEntry, rowsToVaultSuggestions } from './vault.ts';

test('vault rows keep both credits and never invent a zero count', () => {
    const entry = rowToVaultEntry({
        id: 'e1',
        organization_id: 'o1',
        client_id: 'c1',
        lineage_id: 'e1',
        version_no: 1,
        entry_type: 'rule',
        status: 'active',
        title: 'No doorway pages',
        body: 'Do not publish them.',
        rule_kind: 'content',
        enforcement: 'block',
        rule_details: { statement: 'Block them.' },
        applies_to: ['content'],
        effective_on: '2026-10-01',
        pinned: false,
        author_id: 'admin',
        author_name: 'Ada Admin',
        proposed_by: 'member',
        proposed_by_name: 'Morgan Member',
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
    });
    assert.equal(entry?.authorName, 'Ada Admin');
    assert.equal(entry?.proposedByName, 'Morgan Member');
    assert.equal(entry?.enforcement, 'block');
    assert.deepEqual(rowToVaultCounts({ active: 0, inbox: null }), { active: 0, inbox: null });
    assert.deepEqual(rowToVaultCounts({}), { active: null, inbox: null });
    assert.equal(rowToVaultEntry({ id: 'x' }), null);
});

test('suggestion payloads and entry detail map sources without dropping a verbatim quote', () => {
    const input = payloadToInput({
        entry_type: 'decision',
        title: 'Canonical',
        body: 'Keep it.',
        effective_on: '2026-10-01',
        quote: 'Please keep the em dash — exactly.',
        source_kind: 'member_proposal',
        applies_to: ['technical_seo'],
    });
    assert.equal(input.quote, 'Please keep the em dash — exactly.');
    assert.equal(input.sourceKind, 'member_proposal');
    const detail = rowToVaultDetail({
        entry: { id: 'e1', entry_type: 'decision', status: 'active', title: 'Canonical', body: 'Keep it.', version_no: 2, effective_on: '2026-10-02' },
        sources: [{ id: 's1', quote: 'Please keep the em dash — exactly.', source_kind: 'meeting', source_ref: 'notes' }],
        history: [
            { id: 'e1', entry_type: 'decision', status: 'active', title: 'Canonical', body: 'Keep it.', version_no: 2, effective_on: '2026-10-02' },
            { id: 'e0', entry_type: 'decision', status: 'superseded', title: 'Old', body: 'Old body', version_no: 1, effective_on: '2026-10-01' },
        ],
        evidence: [],
    });
    assert.equal(detail?.sources[0].quote, 'Please keep the em dash — exactly.');
    assert.equal(detail?.history.length, 2);
    assert.deepEqual(detail?.evidence, []);
    const suggestions = rowsToVaultSuggestions([{
        id: 'sg1', status: 'pending', proposed_by: 'member', payload: { entry_type: 'approval', title: 'Approve FAQ', body: 'Yes', effective_on: '2026-10-03' },
    }]);
    assert.equal(suggestions[0].payload.title, 'Approve FAQ');
});

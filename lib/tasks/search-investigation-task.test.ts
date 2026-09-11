import assert from 'node:assert/strict';
import test from 'node:test';

import { taskInsertToRpcPayload } from '../supabase/tasks.ts';

test('investigation task payload carries supported task fields but no caller scope', () => {
    const payload = taskInsertToRpcPayload({
        organizationId: 'untrusted-org',
        clientId: 'untrusted-client',
        projectId: 'untrusted-project',
        title: 'Investigate hardscape contractor',
        description: 'Observed evidence only.',
        priority: 'medium',
        status: 'todo',
        category: 'strategy',
        tags: ['gsc', 'search-insights'],
        assigneeIds: ['11111111-1111-1111-1111-111111111111'],
        sourceInvestigationId: '22222222-2222-2222-2222-222222222222',
        syncToBasecamp: true,
        actorName: 'Untrusted actor',
    });

    assert.deepEqual(payload, {
        title: 'Investigate hardscape contractor',
        description: 'Observed evidence only.',
        priority: 'medium',
        status: 'todo',
        category: 'strategy',
        tags: ['gsc', 'search-insights'],
        assigneeIds: ['11111111-1111-1111-1111-111111111111'],
    });
    assert.equal('organization_id' in payload, false);
    assert.equal('client_id' in payload, false);
    assert.equal('custom_fields' in payload, false);
    assert.equal('sourceInvestigationId' in payload, false);
});

test('investigation task payload omits undefined fields instead of changing defaults', () => {
    assert.deepEqual(taskInsertToRpcPayload({
        organizationId: 'org-1',
        title: 'Investigate evidence',
        sourceInvestigationId: 'inv-1',
    }), { title: 'Investigate evidence' });
});

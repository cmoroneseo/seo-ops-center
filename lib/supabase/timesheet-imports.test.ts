import test from 'node:test';
import assert from 'node:assert/strict';
import { mapImportQueueRow } from './timesheet-imports.ts';
import type { ProjectRoleRecord } from '@/lib/basecamp/project-roles.ts';

test('an internal queue row clears stale client data and cannot consume budget', () => {
    const projectRoles = new Map<string, ProjectRoleRecord>([
        ['55', {
            basecampProjectId: '55',
            basecampProjectName: 'Internal work',
            role: 'internal',
            clientId: null,
        }],
    ]);

    const row = mapImportQueueRow({
        id: 'log-1',
        user_id: 'user-abel',
        client_id: 'stale-client',
        activity_key: 'technical_audit',
        task_id: null,
        import_status: 'needs_context',
        date: '2026-08-06',
        hours: '4.5',
        description: 'Internal work',
        counts_toward_budget: true,
        review_note: null,
        basecamp_project_id: 55,
        clients: { name: 'Stale Client' },
        tasks: null,
    }, projectRoles);

    assert.equal(row.isInternal, true);
    assert.equal(row.clientId, null);
    assert.equal(row.clientName, null);
    assert.equal(row.countsTowardBudget, false);
});

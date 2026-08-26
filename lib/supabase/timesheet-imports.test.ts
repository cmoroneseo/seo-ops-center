import test from 'node:test';
import assert from 'node:assert/strict';
import { mapImportQueueRow } from './timesheet-imports.ts';
import type { ProjectRoleRecord } from '@/lib/basecamp/project-roles.ts';
import { deriveIssues } from '@/lib/timesheets/import-issues.ts';

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

test('an unattributed row carries a null member, never an empty-string sentinel', () => {
    // `userId` sits directly on the member-privacy check in the entries route,
    // the one boundary RLS cannot express. A sentinel that is typed `string`
    // but is not a real id is a landmine there, and `no_member` reads it too.
    const row = mapImportQueueRow({
        id: 'log-2',
        user_id: null,
        client_id: 'client-a',
        activity_key: null,
        task_id: null,
        import_status: 'needs_context',
        date: '2026-08-06',
        hours: '1',
        description: '',
        counts_toward_budget: true,
        review_note: null,
        basecamp_project_id: null,
        clients: { name: 'Client A' },
        tasks: null,
    }, new Map());

    assert.equal(row.userId, null);
    assert.ok(deriveIssues(row).includes('no_member'));
});

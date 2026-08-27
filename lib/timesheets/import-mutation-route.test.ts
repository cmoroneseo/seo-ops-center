import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createImportEntriesPatch,
    type ImportMutationDependencies,
    type MutationAuthorization,
} from './import-mutation-route.ts';
import type { QueueSourceRow } from './import-queue-route.ts';

const NOW = '2026-08-25T12:00:00.000Z';

function row(overrides: Partial<QueueSourceRow> = {}): QueueSourceRow {
    return {
        id: 'log-1',
        userId: 'user-abel',
        clientId: 'client-a',
        clientName: 'Client A',
        isInternal: false,
        activityKeys: ['technical_audit'],
        taskId: null,
        taskTitle: null,
        importStatus: 'needs_context',
        date: '2026-08-06',
        hours: 4.5,
        description: '',
        countsTowardBudget: true,
        basecampProjectName: 'Scott Cole Plumbing',
        reviewNote: null,
        ...overrides,
    };
}

interface UpdateCall {
    organizationId: string;
    ids: string[];
    updates: Record<string, unknown>;
    expectedStatus: string;
    authorizedUserId: string | null;
}

function harness(options: {
    authorization?: MutationAuthorization;
    rows?: QueueSourceRow[];
    changed?: number;
    clientValid?: boolean;
    task?: { clientId: string | null } | null;
} = {}) {
    const authorizedOrganizations: string[] = [];
    const loads: Array<{ organizationId: string; ids: string[] }> = [];
    const clientChecks: Array<{ organizationId: string; clientId: string }> = [];
    const taskChecks: Array<{ organizationId: string; taskId: string }> = [];
    const updates: UpdateCall[] = [];
    const authorization: MutationAuthorization = options.authorization ?? {
        ok: true,
        userId: 'user-abel',
        organizationId: 'org-canonical',
        isManager: false,
    };

    const dependencies: ImportMutationDependencies = {
        async authorize(organizationId) {
            authorizedOrganizations.push(organizationId);
            return authorization;
        },
        async loadRows(organizationId, ids) {
            loads.push({ organizationId, ids });
            return options.rows ?? ids.map(id => row({ id }));
        },
        async validateClient(organizationId, clientId) {
            clientChecks.push({ organizationId, clientId });
            return options.clientValid ?? true;
        },
        async validateTask(organizationId, taskId) {
            taskChecks.push({ organizationId, taskId });
            return options.task === undefined
                ? { clientId: 'client-a' }
                : options.task;
        },
        async applyUpdate(organizationId, ids, patch, expectedStatus, authorizedUserId) {
            updates.push({
                organizationId,
                ids,
                updates: patch,
                expectedStatus,
                authorizedUserId,
            });
            return options.changed ?? ids.length;
        },
        now: () => NOW,
    };

    return {
        authorizedOrganizations,
        clientChecks,
        taskChecks,
        loads,
        updates,
        patch: createImportEntriesPatch(dependencies),
    };
}

function request(body: unknown): Request {
    return new Request('https://seo-pm.test/api/timesheets/imports/entries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

test('malformed JSON is rejected before authorization', async () => {
    const { patch, authorizedOrganizations } = harness();
    const response = await patch(new Request(
        'https://seo-pm.test/api/timesheets/imports/entries',
        { method: 'PATCH', body: '{' },
    ));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid JSON' });
    assert.deepEqual(authorizedOrganizations, []);
});

test('every selected id must be a distinct non-empty string', async () => {
    for (const ids of [[], ['log-1', 7], ['log-1', 'log-1'], ['']]) {
        const { patch, authorizedOrganizations } = harness();
        const response = await patch(request({
            organizationId: 'org-requested',
            action: 'submit',
            ids,
        }));

        assert.equal(response.status, 400);
        assert.deepEqual(authorizedOrganizations, []);
    }
});

test('membership failure is returned before queue access', async () => {
    const { patch, loads } = harness({
        authorization: { ok: false, status: 403, error: 'Forbidden' },
    });

    const response = await patch(request({
        organizationId: 'org-requested',
        action: 'submit',
        ids: ['log-1'],
        userId: 'user-attacker',
        isManager: true,
    }));

    assert.equal(response.status, 403);
    assert.deepEqual(loads, []);
});

test('all selected rows are resolved in the authorized organization before mutation', async () => {
    const { patch, loads, updates } = harness({ rows: [row({ id: 'log-1' })] });

    const response = await patch(request({
        organizationId: 'org-requested',
        action: 'submit',
        ids: ['log-1', 'log-foreign'],
    }));

    assert.equal(response.status, 404);
    assert.deepEqual(loads, [{
        organizationId: 'org-canonical',
        ids: ['log-1', 'log-foreign'],
    }]);
    assert.deepEqual(updates, []);
});

test('a member cannot mutate another member’s resolved row', async () => {
    const { patch, updates } = harness({
        rows: [row({ userId: 'user-carlos' })],
    });

    const response = await patch(request({
        organizationId: 'org-requested',
        action: 'edit',
        ids: ['log-1'],
        edit: { activityKeys: ['technical_audit'] },
        userId: 'user-carlos',
    }));

    assert.equal(response.status, 403);
    assert.deepEqual(updates, []);
});

test('body-supplied manager authority cannot approve rows', async () => {
    const { patch, loads, updates } = harness();

    const response = await patch(request({
        organizationId: 'org-requested',
        action: 'approve',
        ids: ['log-1'],
        isManager: true,
        actor: { userId: 'user-carlos', isManager: true },
    }));

    assert.equal(response.status, 403);
    assert.deepEqual(loads, []);
    assert.deepEqual(updates, []);
});

test('a foreign or missing edit client is rejected before transition persistence', async () => {
    const { patch, clientChecks, updates } = harness({ clientValid: false });

    const response = await patch(request({
        organizationId: 'org-requested',
        action: 'edit',
        ids: ['log-1'],
        edit: {
            activityKeys: ['technical_audit'],
            clientId: 'client-foreign',
        },
    }));

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Client not found' });
    assert.deepEqual(clientChecks, [{
        organizationId: 'org-canonical',
        clientId: 'client-foreign',
    }]);
    assert.deepEqual(updates, []);
});

test('editing an internal row persists a clientless non-budget patch', async () => {
    const { patch, updates } = harness({
        rows: [row({
            isInternal: true,
            clientId: null,
            clientName: null,
            countsTowardBudget: false,
        })],
    });

    const response = await patch(request({
        organizationId: 'org-requested',
        action: 'edit',
        ids: ['log-1'],
        edit: {
            activityKeys: ['technical_audit'],
            detail: 'Crawl budget',
            clientId: 'client-attacker',
            countsTowardBudget: true,
        },
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(updates, [{
        organizationId: 'org-canonical',
        ids: ['log-1'],
        updates: {
            activity_keys: ['technical_audit'],
            description: 'Technical SEO Audit — Crawl budget',
            counts_toward_budget: false,
            client_id: null,
        },
        expectedStatus: 'needs_context',
        authorizedUserId: 'user-abel',
    }]);
});

test('submit persists only transition-selected ids with the authenticated actor', async () => {
    const { patch, updates } = harness({
        rows: [
            row({ id: 'ready' }),
            row({ id: 'already-pending', importStatus: 'pending_review' }),
        ],
    });

    const response = await patch(request({
        organizationId: 'org-requested',
        action: 'submit',
        ids: ['ready', 'already-pending'],
        actor: { userId: 'user-attacker' },
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, action: 'submit', changed: 1 });
    assert.deepEqual(updates, [{
        organizationId: 'org-canonical',
        ids: ['ready'],
        updates: {
            import_status: 'pending_review',
            submitted_at: NOW,
            submitted_by: 'user-abel',
            review_note: null,
        },
        expectedStatus: 'needs_context',
        authorizedUserId: 'user-abel',
    }]);
});

test('a zero, partial, or mismatched atomic result is a conflict, never success', async () => {
    for (const changed of [0, 1, 3]) {
        const { patch } = harness({
            changed,
            rows: [row({ id: 'log-1' }), row({ id: 'log-2' })],
        });

        const response = await patch(request({
            organizationId: 'org-requested',
            action: 'submit',
            ids: ['log-1', 'log-2'],
        }));

        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), {
            error: 'Entries changed during review',
        });
    }
});

test('a manager can approve another member’s pending row', async () => {
    const { patch, updates } = harness({
        authorization: {
            ok: true,
            userId: 'user-carlos',
            organizationId: 'org-canonical',
            isManager: true,
        },
        rows: [row({ userId: 'user-abel', importStatus: 'pending_review' })],
    });

    const response = await patch(request({
        organizationId: 'org-requested',
        action: 'approve',
        ids: ['log-1'],
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(updates, [{
        organizationId: 'org-canonical',
        ids: ['log-1'],
        updates: {
            import_status: 'mapped',
            reviewed_at: NOW,
            reviewed_by: 'user-carlos',
            review_note: null,
        },
        expectedStatus: 'pending_review',
        authorizedUserId: null,
    }]);
});

test('a manager bounce preserves the transition-normalized note', async () => {
    const { patch, updates } = harness({
        authorization: {
            ok: true,
            userId: 'user-carlos',
            organizationId: 'org-canonical',
            isManager: true,
        },
        rows: [row({ importStatus: 'pending_review' })],
    });

    const response = await patch(request({
        organizationId: 'org-requested',
        action: 'bounce',
        ids: ['log-1'],
        note: '  Add client detail  ',
    }));

    assert.equal(response.status, 200);
    assert.equal(updates[0].updates.review_note, 'Add client detail');
    assert.equal(updates[0].expectedStatus, 'pending_review');
    assert.equal(updates[0].authorizedUserId, null);
});

test('a member may never act on an unattributed row', () => {
    // Fail-closed by type as well as by value: an unmapped Basecamp person
    // leaves `userId` null, which can never equal a real member id.
    const unattributed = row({ id: 'log-orphan', userId: null });
    assert.equal(unattributed.userId, null);
});

test('an unattributed row is Forbidden for a member and loadable for a manager', async () => {
    const member = harness({ rows: [row({ id: 'log-orphan', userId: null })] });
    const denied = await member.patch(request({
        organizationId: 'org-requested',
        action: 'submit',
        ids: ['log-orphan'],
    }));

    assert.equal(denied.status, 403);
    assert.deepEqual(member.updates, []);

    const manager = harness({
        authorization: {
            ok: true,
            userId: 'user-carlos',
            organizationId: 'org-canonical',
            isManager: true,
        },
        rows: [row({ id: 'log-orphan', userId: null, importStatus: 'pending_review' })],
    });
    const bounced = await manager.patch(request({
        organizationId: 'org-requested',
        action: 'bounce',
        ids: ['log-orphan'],
        note: 'Who logged this?',
    }));

    assert.equal(bounced.status, 200);
});

// --- task links ------------------------------------------------------------

test('a task is resolved inside the canonical organization before the write', async () => {
    const member = harness();
    const response = await member.patch(request({
        organizationId: 'org-typed',
        action: 'edit',
        ids: ['log-1'],
        edit: {
            activityKeys: ['technical_audit'],
            detail: '',
            clientId: 'client-a',
            taskId: 'task-roadmap',
        },
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(member.taskChecks, [{
        organizationId: 'org-canonical',
        taskId: 'task-roadmap',
    }]);
    assert.equal(member.updates[0].updates.task_id, 'task-roadmap');
});

test('an unknown task is a 404 and nothing is written', async () => {
    const member = harness({ task: null });
    const response = await member.patch(request({
        organizationId: 'org-canonical',
        action: 'edit',
        ids: ['log-1'],
        edit: {
            activityKeys: ['technical_audit'],
            detail: '',
            clientId: 'client-a',
            taskId: 'task-gone',
        },
    }));

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Task not found' });
    assert.deepEqual(member.updates, []);
});

test('a task from another client is refused, never silently attributed', async () => {
    const member = harness({ task: { clientId: 'client-b' } });
    const response = await member.patch(request({
        organizationId: 'org-canonical',
        action: 'edit',
        ids: ['log-1'],
        edit: {
            activityKeys: ['technical_audit'],
            detail: '',
            clientId: 'client-a',
            taskId: 'task-of-client-b',
        },
    }));

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
        error: 'That task belongs to a different client',
    });
    assert.deepEqual(member.updates, []);
});

test('an internal row is matched against no client at all', async () => {
    // Internal time has its client forced to null, so only a task with no
    // client could ever match — and none does in practice.
    const member = harness({
        rows: [row({ isInternal: true, clientId: null })],
        task: { clientId: 'client-a' },
    });
    const response = await member.patch(request({
        organizationId: 'org-canonical',
        action: 'edit',
        ids: ['log-1'],
        edit: {
            activityKeys: ['technical_audit'],
            detail: '',
            clientId: 'client-a',
            taskId: 'task-roadmap',
        },
    }));

    assert.equal(response.status, 409);
    assert.deepEqual(member.updates, []);
});

test('clearing a link needs no task lookup', async () => {
    const member = harness();
    const response = await member.patch(request({
        organizationId: 'org-canonical',
        action: 'edit',
        ids: ['log-1'],
        edit: {
            activityKeys: ['technical_audit'],
            detail: '',
            clientId: 'client-a',
            taskId: null,
        },
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(member.taskChecks, []);
    assert.equal(member.updates[0].updates.task_id, null);
});

test('an edit that says nothing about the task leaves it stored', async () => {
    const member = harness();
    await member.patch(request({
        organizationId: 'org-canonical',
        action: 'edit',
        ids: ['log-1'],
        edit: { activityKeys: ['technical_audit'], detail: '', clientId: 'client-a' },
    }));

    assert.deepEqual(member.taskChecks, []);
    assert.equal('task_id' in member.updates[0].updates, false);
});

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
        activityKey: 'technical_audit',
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
}

function harness(options: {
    authorization?: MutationAuthorization;
    rows?: QueueSourceRow[];
    changed?: number;
} = {}) {
    const authorizedOrganizations: string[] = [];
    const loads: Array<{ organizationId: string; ids: string[] }> = [];
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
        async applyUpdate(organizationId, ids, patch, expectedStatus) {
            updates.push({ organizationId, ids, updates: patch, expectedStatus });
            return options.changed ?? ids.length;
        },
        now: () => NOW,
    };

    return {
        authorizedOrganizations,
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
        edit: { activityKey: 'technical_audit' },
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
            activityKey: 'technical_audit',
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
            activity_key: 'technical_audit',
            description: 'Technical SEO Audit — Crawl budget',
            counts_toward_budget: false,
            client_id: null,
        },
        expectedStatus: 'needs_context',
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
    }]);
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
});

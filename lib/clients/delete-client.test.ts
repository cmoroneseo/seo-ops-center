import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    ARCHIVED_CLIENT_STATUS,
    DELETE_CLIENT_FORBIDDEN,
    archivedClientPath,
    canDeleteClient,
    deleteClient,
    readArchivedClientNotice,
    type DeleteClientAuth,
    type DeleteClientDeps,
} from './delete-client';

const clientId = 'cbba5b14-7e24-4913-b396-0fff7fb2df17';
const organizationId = '06e536b9-beac-49bc-8c96-1df021102590';

function allowed(role: DeleteClientAuth extends { ok: true } ? DeleteClientAuth['role'] : never): DeleteClientAuth {
    return {
        ok: true,
        userId: 'user-1',
        actorName: 'Carlos',
        organizationId,
        clientId,
        role,
    };
}

function deps(overrides: Partial<DeleteClientDeps> & { auth?: DeleteClientAuth; status?: string } = {}): DeleteClientDeps & { archivedCount: number; logged: unknown[] } {
    const recorded = { archived: 0, logged: [] as unknown[] };
    return {
        logged: recorded.logged,
        authorize: async () => overrides.auth ?? allowed('member'),
        loadClient: async () => ({ name: 'SynBlades', status: overrides.status ?? 'active' }),
        archiveClient: async () => {
            recorded.archived += 1;
            return {};
        },
        logStatusChange: async (event) => {
            recorded.logged.push(event);
        },
        get archivedCount() { return recorded.archived; },
        ...overrides,
    };
}

test('client managers can delete a client and viewers cannot', () => {
    assert.equal(canDeleteClient('owner'), true);
    assert.equal(canDeleteClient('admin'), true);
    assert.equal(canDeleteClient('member'), true);
    assert.equal(canDeleteClient('viewer'), false);
    assert.equal(canDeleteClient(undefined), false);
});

test('archive notice round-trips the client name', () => {
    assert.equal(readArchivedClientNotice(archivedClientPath('SynBlades').split('?')[1]), 'SynBlades');
    assert.equal(readArchivedClientNotice('?clientArchived=North%20%26%20Co'), 'North & Co');
    assert.equal(readArchivedClientNotice(''), null);
    assert.equal(readArchivedClientNotice('?clientArchived=%20'), null);
});

test('a member archives an active client and records the status change', async () => {
    const store = deps();
    const response = await deleteClient(clientId, store);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        ok: true,
        archived: true,
        clientName: 'SynBlades',
        status: ARCHIVED_CLIENT_STATUS,
    });
    assert.equal(store.archivedCount, 1);
    assert.deepEqual(store.logged, [{
        organizationId,
        clientId,
        actorId: 'user-1',
        actorName: 'Carlos',
        clientName: 'SynBlades',
        fromStatus: 'Active',
        toStatus: 'Cancelled',
    }]);
});

test('archiving a client that is already cancelled does not write again', async () => {
    const store = deps({ status: 'inactive' });
    const response = await deleteClient(clientId, store);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'Cancelled');
    assert.equal(store.archivedCount, 0);
    assert.deepEqual(store.logged, []);
});

test('a viewer is rejected before the archive write', async () => {
    let loaded = false;
    const store = deps({
        auth: allowed('viewer'),
        loadClient: async () => {
            loaded = true;
            return { name: 'SynBlades', status: 'active' };
        },
    });
    const response = await deleteClient(clientId, store);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, DELETE_CLIENT_FORBIDDEN);
    assert.equal(loaded, false);
    assert.equal(store.archivedCount, 0);
});

test('missing auth, foreign clients, and bad ids never archive', async () => {
    const denied = deps({ auth: { ok: false, status: 401, error: 'Unauthorized' } });
    assert.equal((await deleteClient(clientId, denied)).status, 401);
    assert.equal(denied.archivedCount, 0);

    const foreign = deps({ auth: { ok: false, status: 403, error: 'Forbidden' } });
    assert.equal((await deleteClient(clientId, foreign)).status, 403);

    const missing = deps({ loadClient: async () => null });
    assert.equal((await deleteClient(clientId, missing)).status, 404);
    assert.equal(missing.archivedCount, 0);

    const invalid = deps();
    assert.equal((await deleteClient('not-a-client', invalid)).status, 400);
    assert.equal(invalid.archivedCount, 0);
});

test('an archive failure is returned and not logged as a status change', async () => {
    const store = deps({
        archiveClient: async () => ({ error: DELETE_CLIENT_FORBIDDEN, statusCode: 403 }),
    });
    const response = await deleteClient(clientId, store);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, DELETE_CLIENT_FORBIDDEN);
    assert.deepEqual(store.logged, []);
});

test('a failed activity log still reports the archive', async () => {
    const store = deps({
        logStatusChange: async () => { throw new Error('log down'); },
    });
    const response = await deleteClient(clientId, store);
    assert.equal(response.status, 200);
    assert.equal(store.archivedCount, 1);
});

test('the delete route authorizes the client row and archives through the user session', () => {
    const route = readFileSync(new URL('../../app/api/clients/[id]/route.ts', import.meta.url), 'utf8');
    assert.match(route, /requireClientOrgMember/);
    assert.match(route, /deleteClient/);
    assert.match(route, /status: ARCHIVED_CLIENT_DB_STATUS/);
    assert.match(route, /createServerClient/);
    assert.doesNotMatch(route, /req\.json|request\.json|createAdminClient/);
    assert.doesNotMatch(route, /searchParams|body\.organizationId/);
});

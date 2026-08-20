import { test } from 'node:test';
import assert from 'node:assert/strict';

type RouteModule = typeof import('./config-route.ts');

async function loadRouteModule(): Promise<RouteModule> {
    try {
        return await import('./config-route.ts');
    } catch (error) {
        assert.fail(`Request-level Basecamp config handlers must be implemented: ${String(error)}`);
    }
}

const request = (body?: Record<string, unknown>) => new Request(
    'https://seo-ops.test/api/clients/client-a/basecamp-config',
    body ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    } : undefined,
);

const authorized = {
    ok: true as const,
    userId: 'user-1',
    actorName: 'User One',
    organizationId: 'org-a',
    clientId: 'client-a',
    role: 'admin' as const,
    canManageIntegrations: true,
};

const denied = { ok: false as const, status: 403 as const, error: 'Forbidden' };

function externalSource(projects: Array<string | number> = ['202']) {
    return {
        findMembership: async () => ({ organizationIsInternal: false }),
        listConfiguredProjectIds: async () => projects,
    };
}

async function responseBody(response: Response) {
    return await response.json() as Record<string, unknown>;
}

test('config GET rejects a known foreign client before creating the service-role store', async () => {
    const { createBasecampConfigHandlers } = await loadRouteModule();
    const { get } = createBasecampConfigHandlers({
        authorizeClient: async () => denied,
        createStore: () => { throw new Error('service-role store must not be created'); },
        createAccessSource: () => { throw new Error('project source must not be created'); },
        isConfigured: () => false,
        listProjects: async () => [],
        listTodolists: async () => [],
    });

    const response = await get(request(), 'client-victim');

    assert.equal(response.status, 403);
    assert.deepEqual(await responseBody(response), { error: 'Forbidden' });
});

test('config POST rejects a non-manager before service-role or provider access', async () => {
    const { createBasecampConfigHandlers } = await loadRouteModule();
    const { post } = createBasecampConfigHandlers({
        authorizeClient: async () => denied,
        createStore: () => { throw new Error('service-role store must not be created'); },
        createAccessSource: () => { throw new Error('project source must not be created'); },
        isConfigured: () => { throw new Error('provider configuration must not be read'); },
        listProjects: async () => { throw new Error('provider must not be called'); },
        listTodolists: async () => { throw new Error('provider must not be called'); },
    });

    const response = await post(request({ basecamp_project_id: '999' }), 'client-victim');

    assert.equal(response.status, 403);
});

test('config POST rejects unauthenticated callers before service-role or provider access', async () => {
    const { createBasecampConfigHandlers } = await loadRouteModule();
    const { post } = createBasecampConfigHandlers({
        authorizeClient: async () => ({ ok: false, status: 401, error: 'Unauthorized' }),
        createStore: () => { throw new Error('service-role store must not be created'); },
        createAccessSource: () => { throw new Error('project source must not be created'); },
        isConfigured: () => { throw new Error('provider configuration must not be read'); },
        listProjects: async () => { throw new Error('provider must not be called'); },
        listTodolists: async () => { throw new Error('provider must not be called'); },
    });

    const response = await post(request({ basecamp_project_id: '202' }), 'client-a');

    assert.equal(response.status, 401);
    assert.deepEqual(await responseBody(response), { error: 'Unauthorized' });
});

test('external config cannot nominate a different project even when another client has that binding', async () => {
    const { createBasecampConfigHandlers } = await loadRouteModule();
    let updated = false;
    const { post } = createBasecampConfigHandlers({
        authorizeClient: async () => authorized,
        createStore: () => ({
            getClient: async () => ({
                id: 'client-a',
                name: 'Client A',
                organizationId: 'org-a',
                customFields: { basecamp_project_id: '202' },
            }),
            updateClientCustomFields: async () => { updated = true; return null; },
            logActivity: async () => {},
        }),
        createAccessSource: () => externalSource(['202', '303']),
        isConfigured: () => true,
        listProjects: async () => { throw new Error('external catalog must not be listed'); },
        listTodolists: async () => { throw new Error('external different project must not reach provider'); },
    });

    const response = await post(request({ basecamp_project_id: '303' }), 'client-a');

    assert.equal(response.status, 403);
    assert.equal(updated, false);
});

test('external config may preserve its trusted project and select a list verified under that project', async () => {
    const { createBasecampConfigHandlers } = await loadRouteModule();
    let saved: Record<string, unknown> | null = null;
    const { post } = createBasecampConfigHandlers({
        authorizeClient: async () => authorized,
        createStore: () => ({
            getClient: async (clientId, organizationId) => {
                assert.deepEqual([clientId, organizationId], ['client-a', 'org-a']);
                return {
                    id: 'client-a',
                    name: 'Client A',
                    organizationId: 'org-a',
                    customFields: { basecamp_project_id: 202, keep_me: true },
                };
            },
            updateClientCustomFields: async (_clientId, organizationId, customFields) => {
                assert.equal(organizationId, 'org-a');
                saved = customFields;
                return null;
            },
            logActivity: async () => {},
        }),
        createAccessSource: () => externalSource(),
        isConfigured: () => true,
        listProjects: async () => { throw new Error('external catalog must not be listed'); },
        listTodolists: async projectId => {
            assert.equal(projectId, '202');
            return [{ id: 44, title: 'SEO', name: 'SEO', todos_count: 1 }];
        },
    });

    const response = await post(request({
        basecamp_project_id: '202',
        basecamp_todolist_id: '44',
        basecamp_sync_enabled: true,
        basecamp_timesheet_enabled: false,
    }), 'client-a');

    assert.equal(response.status, 200);
    assert.deepEqual(saved, {
        basecamp_project_id: '202',
        keep_me: true,
        basecamp_todolist_id: '44',
        basecamp_sync_enabled: true,
        basecamp_timesheet_enabled: false,
    });
});

test('external config may clear its existing binding without provider access', async () => {
    const { createBasecampConfigHandlers } = await loadRouteModule();
    let saved: Record<string, unknown> | null = null;
    const { post } = createBasecampConfigHandlers({
        authorizeClient: async () => authorized,
        createStore: () => ({
            getClient: async () => ({
                id: 'client-a',
                name: 'Client A',
                organizationId: 'org-a',
                customFields: {
                    basecamp_project_id: '202',
                    basecamp_todolist_id: '44',
                    basecamp_sync_enabled: true,
                    keep_me: true,
                },
            }),
            updateClientCustomFields: async (_clientId, _organizationId, fields) => {
                saved = fields;
                return null;
            },
            logActivity: async () => {},
        }),
        createAccessSource: () => { throw new Error('project source must not be created'); },
        isConfigured: () => { throw new Error('provider configuration must not be read'); },
        listProjects: async () => { throw new Error('provider must not be called'); },
        listTodolists: async () => { throw new Error('provider must not be called'); },
    });

    const response = await post(request({ basecamp_project_id: null }), 'client-a');

    assert.equal(response.status, 200);
    assert.deepEqual(saved, {
        basecamp_project_id: null,
        basecamp_todolist_id: null,
        basecamp_sync_enabled: false,
        basecamp_timesheet_enabled: false,
        basecamp_timesheet_recording_id: null,
        keep_me: true,
    });
});

test('internal config rejects a project absent from the trusted Basecamp catalog', async () => {
    const { createBasecampConfigHandlers } = await loadRouteModule();
    let updated = false;
    const { post } = createBasecampConfigHandlers({
        authorizeClient: async () => authorized,
        createStore: () => ({
            getClient: async () => ({
                id: 'client-a',
                name: 'Client A',
                organizationId: 'org-a',
                customFields: {},
            }),
            updateClientCustomFields: async () => { updated = true; return null; },
            logActivity: async () => {},
        }),
        createAccessSource: () => ({
            findMembership: async () => ({ organizationIsInternal: true }),
            listConfiguredProjectIds: async () => [],
        }),
        isConfigured: () => true,
        listProjects: async () => [{ id: 202, name: 'Catalog project', description: '', status: 'active' }],
        listTodolists: async () => { throw new Error('list lookup must not run'); },
    });

    const response = await post(request({ basecamp_project_id: '999' }), 'client-a');

    assert.equal(response.status, 403);
    assert.deepEqual(await responseBody(response), { error: 'Project is not in the trusted catalog' });
    assert.equal(updated, false);
});

test('internal integration managers can bind a catalog project and verified list', async () => {
    const { createBasecampConfigHandlers } = await loadRouteModule();
    let saved: Record<string, unknown> | null = null;
    const { post } = createBasecampConfigHandlers({
        authorizeClient: async () => authorized,
        createStore: () => ({
            getClient: async () => ({
                id: 'client-a',
                name: 'Client A',
                organizationId: 'org-a',
                customFields: { keep_me: true },
            }),
            updateClientCustomFields: async (_clientId, _organizationId, fields) => {
                saved = fields;
                return null;
            },
            logActivity: async () => {},
        }),
        createAccessSource: () => ({
            findMembership: async () => ({ organizationIsInternal: true }),
            listConfiguredProjectIds: async () => [],
        }),
        isConfigured: () => true,
        listProjects: async () => [{ id: 202, name: 'Catalog project', description: '', status: 'active' }],
        listTodolists: async () => [{ id: 44, title: 'SEO', name: 'SEO', todos_count: 1 }],
    });

    const response = await post(request({
        basecamp_project_id: '202',
        basecamp_todolist_id: '44',
        basecamp_sync_enabled: true,
    }), 'client-a');

    assert.equal(response.status, 200);
    assert.equal(saved?.basecamp_project_id, '202');
    assert.equal(saved?.basecamp_todolist_id, '44');
});

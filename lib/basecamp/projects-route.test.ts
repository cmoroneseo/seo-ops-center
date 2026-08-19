import { test } from 'node:test';
import assert from 'node:assert/strict';

type RouteModule = typeof import('./projects-route.ts');

async function loadRouteModule(): Promise<RouteModule> {
    try {
        return await import('./projects-route.ts');
    } catch (error) {
        assert.fail(`Request-level Basecamp projects GET handler must be implemented: ${String(error)}`);
    }
}

const request = (organizationId?: string) => new Request(
    `https://seo-ops.test/api/integrations/basecamp/projects${organizationId === undefined
        ? ''
        : `?organizationId=${encodeURIComponent(organizationId)}`}`,
);

const project = (id: number, name: string) => ({
    id,
    name,
    description: '',
    status: 'active',
});

async function body(response: Response) {
    return await response.json() as Record<string, unknown>;
}

test('GET rejects unauthenticated requests before constructing authorization or Basecamp catalog dependencies', async () => {
    const { createBasecampProjectsGet } = await loadRouteModule();
    const get = createBasecampProjectsGet({
        getUserId: async () => null,
        createAccessSource: () => { throw new Error('authorization source must not be constructed'); },
        createCatalog: () => { throw new Error('Basecamp catalog must not be constructed'); },
    });

    const response = await get(request('org-internal'));

    assert.equal(response.status, 401);
    assert.deepEqual(await body(response), { error: 'Unauthorized' });
});

test('GET rejects a missing organizationId before constructing authorization or Basecamp catalog dependencies', async () => {
    const { createBasecampProjectsGet } = await loadRouteModule();
    const get = createBasecampProjectsGet({
        getUserId: async () => 'user-1',
        createAccessSource: () => { throw new Error('authorization source must not be constructed'); },
        createCatalog: () => { throw new Error('Basecamp catalog must not be constructed'); },
    });

    const response = await get(request());

    assert.equal(response.status, 400);
    assert.deepEqual(await body(response), { error: 'organizationId required' });
});

test('GET rejects a non-member before constructing or calling the shared Basecamp catalog', async () => {
    const { createBasecampProjectsGet } = await loadRouteModule();
    const get = createBasecampProjectsGet({
        getUserId: async () => 'user-outsider',
        createAccessSource: () => ({
            findMembership: async () => null,
            listConfiguredProjectIds: async () => { throw new Error('client lookup must not run'); },
        }),
        createCatalog: () => { throw new Error('Basecamp catalog must not be constructed'); },
    });

    const response = await get(request('org-customer'));

    assert.equal(response.status, 403);
    assert.deepEqual(await body(response), { error: 'Forbidden' });
});

test('GET returns the full shared catalog to a member of an internal organization', async () => {
    const { createBasecampProjectsGet } = await loadRouteModule();
    const catalog = [project(101, 'Internal'), project(202, 'Client')];
    const get = createBasecampProjectsGet({
        getUserId: async () => 'user-1',
        createAccessSource: () => ({
            findMembership: async () => ({ organizationIsInternal: true }),
            listConfiguredProjectIds: async () => { throw new Error('allowlist lookup must not run'); },
        }),
        createCatalog: () => ({
            isConfigured: () => true,
            listProjects: async () => catalog,
        }),
    });

    const response = await get(request('org-internal'));

    assert.equal(response.status, 200);
    assert.deepEqual(await body(response), { projects: catalog, configured: true });
});

test('GET applies the requested organization client allowlist before returning an external organization catalog', async () => {
    const { createBasecampProjectsGet } = await loadRouteModule();
    const catalog = [project(101, 'Internal secret'), project(202, 'Allowed client')];
    const get = createBasecampProjectsGet({
        getUserId: async () => 'user-1',
        createAccessSource: () => ({
            findMembership: async (userId, organizationId) => {
                assert.equal(userId, 'user-1');
                assert.equal(organizationId, 'org-customer');
                return { organizationIsInternal: false };
            },
            listConfiguredProjectIds: async organizationId => {
                assert.equal(organizationId, 'org-customer');
                return ['202'];
            },
        }),
        createCatalog: () => ({
            isConfigured: () => true,
            listProjects: async () => catalog,
        }),
    });

    const response = await get(request('org-customer'));

    assert.equal(response.status, 200);
    assert.deepEqual(await body(response), { projects: [catalog[1]], configured: true });
});

test('GET returns an empty external allowlist without calling Basecamp', async () => {
    const { createBasecampProjectsGet } = await loadRouteModule();
    const get = createBasecampProjectsGet({
        getUserId: async () => 'user-1',
        createAccessSource: () => ({
            findMembership: async () => ({ organizationIsInternal: false }),
            listConfiguredProjectIds: async () => [],
        }),
        createCatalog: () => ({
            isConfigured: () => true,
            listProjects: async () => { throw new Error('Basecamp list must not be called'); },
        }),
    });

    const response = await get(request('org-customer'));

    assert.equal(response.status, 200);
    assert.deepEqual(await body(response), { projects: [], configured: true });
});

test('GET returns 503 only after authorization when Basecamp is not configured', async () => {
    const { createBasecampProjectsGet } = await loadRouteModule();
    const get = createBasecampProjectsGet({
        getUserId: async () => 'user-1',
        createAccessSource: () => ({
            findMembership: async () => ({ organizationIsInternal: true }),
            listConfiguredProjectIds: async () => [],
        }),
        createCatalog: () => ({
            isConfigured: () => false,
            listProjects: async () => { throw new Error('Basecamp list must not be called'); },
        }),
    });

    const response = await get(request('org-internal'));

    assert.equal(response.status, 503);
    assert.equal((await body(response)).configured, false);
});

test('GET returns a generic 500 when organization authorization cannot be verified', async () => {
    const { createBasecampProjectsGet } = await loadRouteModule();
    const get = createBasecampProjectsGet({
        getUserId: async () => 'user-1',
        createAccessSource: () => ({
            findMembership: async () => { throw new Error('database details'); },
            listConfiguredProjectIds: async () => [],
        }),
        createCatalog: () => { throw new Error('Basecamp catalog must not be constructed'); },
    });

    const response = await get(request('org-customer'));

    assert.equal(response.status, 500);
    assert.deepEqual(await body(response), { error: 'Unable to verify organization access' });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

type AccessModule = typeof import('./project-access.ts');

async function loadAccessModule(): Promise<AccessModule> {
    try {
        return await import('./project-access.ts');
    } catch (error) {
        assert.fail(`Basecamp project access policy must be implemented: ${String(error)}`);
    }
}

test('rejects an unauthenticated project-catalog request', async () => {
    const { resolveBasecampProjectAccess } = await loadAccessModule();
    const result = await resolveBasecampProjectAccess(
        { userId: null, organizationId: 'org-internal' },
        {
            findMembership: async () => { throw new Error('membership lookup must not run'); },
            listConfiguredProjectIds: async () => { throw new Error('client lookup must not run'); },
        },
    );

    assert.deepEqual(result, { ok: false, status: 401, error: 'Unauthorized' });
});

test('rejects a project-catalog request without an organization', async () => {
    const { resolveBasecampProjectAccess } = await loadAccessModule();
    const result = await resolveBasecampProjectAccess(
        { userId: 'user-1', organizationId: '   ' },
        {
            findMembership: async () => { throw new Error('membership lookup must not run'); },
            listConfiguredProjectIds: async () => { throw new Error('client lookup must not run'); },
        },
    );

    assert.deepEqual(result, { ok: false, status: 400, error: 'organizationId required' });
});

test('rejects a user who is not a member of the requested organization', async () => {
    const { resolveBasecampProjectAccess } = await loadAccessModule();
    const result = await resolveBasecampProjectAccess(
        { userId: 'user-outsider', organizationId: 'org-customer' },
        {
            findMembership: async (userId, organizationId) => {
                assert.equal(userId, 'user-outsider');
                assert.equal(organizationId, 'org-customer');
                return null;
            },
            listConfiguredProjectIds: async () => { throw new Error('client lookup must not run'); },
        },
    );

    assert.deepEqual(result, { ok: false, status: 403, error: 'Forbidden' });
});

test('allows an internal organization member to enumerate the shared catalog', async () => {
    const { resolveBasecampProjectAccess, scopeBasecampProjects } = await loadAccessModule();
    const access = await resolveBasecampProjectAccess(
        { userId: 'user-1', organizationId: 'org-internal' },
        {
            findMembership: async () => ({ organizationIsInternal: true }),
            listConfiguredProjectIds: async () => { throw new Error('client lookup must not run'); },
        },
    );

    assert.deepEqual(access, {
        ok: true,
        organizationId: 'org-internal',
        canEnumerateCatalog: true,
        allowedProjectIds: [],
    });
    assert.deepEqual(scopeBasecampProjects([
        { id: 101, name: 'Alpha' },
        { id: 202, name: 'Beta' },
    ], access), [
        { id: 101, name: 'Alpha' },
        { id: 202, name: 'Beta' },
    ]);
});

test('limits a non-internal organization member to project IDs configured on that organization clients', async () => {
    const { resolveBasecampProjectAccess, scopeBasecampProjects } = await loadAccessModule();
    const access = await resolveBasecampProjectAccess(
        { userId: 'user-1', organizationId: 'org-customer' },
        {
            findMembership: async () => ({ organizationIsInternal: false }),
            listConfiguredProjectIds: async (organizationId) => {
                assert.equal(organizationId, 'org-customer');
                return ['202', 303, null, '', '202'];
            },
        },
    );

    assert.deepEqual(access, {
        ok: true,
        organizationId: 'org-customer',
        canEnumerateCatalog: false,
        allowedProjectIds: ['202', '303'],
    });
    assert.deepEqual(scopeBasecampProjects([
        { id: 101, name: 'Secret internal project' },
        { id: 202, name: 'Configured client' },
        { id: 303, name: 'Configured numeric client' },
    ], access), [
        { id: 202, name: 'Configured client' },
        { id: 303, name: 'Configured numeric client' },
    ]);
});

test('shared project guard rejects a cross-organization project before provider access', async () => {
    const { authorizeBasecampProject } = await loadAccessModule();
    const result = await authorizeBasecampProject(
        { userId: 'user-1', organizationId: 'org-customer', projectId: '999' },
        {
            findMembership: async () => ({ organizationIsInternal: false }),
            listConfiguredProjectIds: async () => ['202'],
        },
    );

    assert.deepEqual(result, { ok: false, status: 403, error: 'Project is not authorized' });
});

test('shared project guard authorizes configured external projects and internal catalog projects', async () => {
    const { authorizeBasecampProject } = await loadAccessModule();

    const external = await authorizeBasecampProject(
        { userId: 'user-1', organizationId: 'org-customer', projectId: 202 },
        {
            findMembership: async () => ({ organizationIsInternal: false }),
            listConfiguredProjectIds: async () => ['202'],
        },
    );
    const internal = await authorizeBasecampProject(
        { userId: 'user-1', organizationId: 'org-internal', projectId: '303' },
        {
            findMembership: async () => ({ organizationIsInternal: true }),
            listConfiguredProjectIds: async () => { throw new Error('allowlist must not run'); },
        },
    );

    assert.deepEqual(external, {
        ok: true,
        organizationId: 'org-customer',
        projectId: '202',
        canEnumerateCatalog: false,
        allowedProjectIds: ['202'],
    });
    assert.deepEqual(internal, {
        ok: true,
        organizationId: 'org-internal',
        projectId: '303',
        canEnumerateCatalog: true,
        allowedProjectIds: [],
    });
});

test('JSON object normalization fails closed for malformed custom_fields values', async () => {
    const { normalizeJsonObject } = await import('./project-access.ts');

    assert.deepEqual(normalizeJsonObject(null), {});
    assert.deepEqual(normalizeJsonObject('malformed'), {});
    assert.deepEqual(normalizeJsonObject(['basecamp_project_id', 202]), {});
    assert.deepEqual(normalizeJsonObject({ basecamp_project_id: 202 }), { basecamp_project_id: 202 });
});

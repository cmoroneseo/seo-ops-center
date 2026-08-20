import { test } from 'node:test';
import assert from 'node:assert/strict';

type RouteModule = typeof import('./imported-ids-route.ts');

async function loadRouteModule(): Promise<RouteModule> {
    try {
        return await import('./imported-ids-route.ts');
    } catch (error) {
        assert.fail(`Request-level imported IDs handler must be implemented: ${String(error)}`);
    }
}

function request(params: Record<string, string>) {
    const url = new URL('https://seo-ops.test/api/integrations/basecamp/imported-ids');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return new Request(url);
}

test('imported IDs rejects unauthenticated and foreign clients before constructing the service-role reader', async () => {
    const { createBasecampImportedIdsGet } = await loadRouteModule();
    for (const denial of [
        { ok: false as const, status: 401, error: 'Unauthorized' },
        { ok: false as const, status: 403, error: 'Forbidden' },
    ]) {
        const get = createBasecampImportedIdsGet({
            authorizeClient: async () => denial,
            createReader: () => { throw new Error('service-role reader must not be constructed'); },
        });

        const response = await get(request({ clientId: 'client-victim', organizationId: 'org-attacker' }));

        assert.equal(response.status, denial.status);
        assert.deepEqual(await response.json(), { error: denial.error });
    }
});

test('imported IDs reads only the canonical authorized client scope', async () => {
    const { createBasecampImportedIdsGet } = await loadRouteModule();
    const get = createBasecampImportedIdsGet({
        authorizeClient: async () => ({
            ok: true,
            userId: 'user-1',
            actorName: 'User One',
            organizationId: 'org-a',
            clientId: 'client-a',
            role: 'member',
        }),
        createReader: () => ({
            listImportedTodoIds: async (clientId, organizationId) => {
                assert.deepEqual([clientId, organizationId], ['client-a', 'org-a']);
                return [77, 88];
            },
        }),
    });

    const response = await get(request({ clientId: 'client-a', organizationId: 'org-a' }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ids: [77, 88] });
});

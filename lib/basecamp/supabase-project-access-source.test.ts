import { test } from 'node:test';
import assert from 'node:assert/strict';

type SourceModule = typeof import('./supabase-project-access-source.ts');

async function loadSourceModule(): Promise<SourceModule> {
    try {
        return await import('./supabase-project-access-source.ts');
    } catch (error) {
        assert.fail(`Production Supabase Basecamp access source must be implemented: ${String(error)}`);
    }
}

type QueryCall =
    | { operation: 'from'; table: string }
    | { operation: 'select'; table: string; columns: string }
    | { operation: 'eq'; table: string; column: string; value: string };

function fakeAdmin() {
    const calls: QueryCall[] = [];
    const results: Record<string, { data: unknown; error: null }> = {
        organization_members: { data: { organization_id: 'org-a' }, error: null },
        organizations: { data: { is_internal: false }, error: null },
        clients: {
            data: [
                { custom_fields: { basecamp_project_id: '202' } },
                { custom_fields: { basecamp_project_id: 303 } },
            ],
            error: null,
        },
    };

    const admin = {
        from(table: string) {
            calls.push({ operation: 'from', table });
            const query = {
                select(columns: string) {
                    calls.push({ operation: 'select', table, columns });
                    return query;
                },
                eq(column: string, value: string) {
                    calls.push({ operation: 'eq', table, column, value });
                    return query;
                },
                async maybeSingle() {
                    return results[table];
                },
                then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
                    return Promise.resolve(results[table]).then(resolve, reject);
                },
            };
            return query;
        },
    };

    return { admin, calls };
}

test('production membership lookup constrains both organization and user before reading is_internal', async () => {
    const { createSupabaseBasecampProjectAccessSource } = await loadSourceModule();
    const { admin, calls } = fakeAdmin();
    const source = createSupabaseBasecampProjectAccessSource(admin as never);

    const membership = await source.findMembership('user-1', 'org-a');

    assert.deepEqual(membership, { organizationIsInternal: false });
    assert.deepEqual(calls, [
        { operation: 'from', table: 'organization_members' },
        { operation: 'select', table: 'organization_members', columns: 'organization_id' },
        { operation: 'eq', table: 'organization_members', column: 'organization_id', value: 'org-a' },
        { operation: 'eq', table: 'organization_members', column: 'user_id', value: 'user-1' },
        { operation: 'from', table: 'organizations' },
        { operation: 'select', table: 'organizations', columns: 'is_internal' },
        { operation: 'eq', table: 'organizations', column: 'id', value: 'org-a' },
    ]);
});

test('production configured-project lookup filters clients by the requested organization', async () => {
    const { createSupabaseBasecampProjectAccessSource } = await loadSourceModule();
    const { admin, calls } = fakeAdmin();
    const source = createSupabaseBasecampProjectAccessSource(admin as never);

    const projectIds = await source.listConfiguredProjectIds('org-a');

    assert.deepEqual(projectIds, ['202', 303]);
    assert.deepEqual(calls, [
        { operation: 'from', table: 'clients' },
        { operation: 'select', table: 'clients', columns: 'custom_fields' },
        { operation: 'eq', table: 'clients', column: 'organization_id', value: 'org-a' },
    ]);
});

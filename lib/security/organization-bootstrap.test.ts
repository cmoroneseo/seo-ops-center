import { test } from 'node:test';
import assert from 'node:assert/strict';

test('organization setup delegates owner creation to the constrained bootstrap RPC', async () => {
    const { createOrganizationWithOwner } = await import('./organization-bootstrap.ts');
    const calls: Array<Record<string, unknown>> = [];
    const organization = await createOrganizationWithOwner(
        { name: 'Agency', slug: 'agency', role: 'owner', userId: 'attacker-choice' } as never,
        {
            createOrganization: async input => {
                calls.push({ operation: 'create', ...input });
                return {
                    id: 'org-new',
                    name: input.name,
                    slug: input.slug,
                    subscription_status: 'trialing',
                    plan_type: 'starter',
                    created_at: '2026-08-20T00:00:00.000Z',
                };
            },
            bootstrapCurrentUserAsOwner: async organizationId => {
                calls.push({ operation: 'bootstrap', organizationId });
            },
        },
    );

    assert.deepEqual(organization, {
        id: 'org-new',
        name: 'Agency',
        slug: 'agency',
        subscription_status: 'trialing',
        plan_type: 'starter',
        created_at: '2026-08-20T00:00:00.000Z',
    });
    assert.deepEqual(calls, [
        { operation: 'create', name: 'Agency', slug: 'agency' },
        { operation: 'bootstrap', organizationId: 'org-new' },
    ]);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { dashboardSessionFromMemberships } from './dashboard-session.ts';
import type { Organization, OrganizationMember } from '@/lib/types';

function member(id: string, organization: Organization | null, createdAt: string): OrganizationMember {
    return {
        id: `mem-${id}`,
        organizationId: id,
        userId: 'user',
        role: 'owner',
        createdAt,
        organization: organization ?? undefined,
    };
}

const first: Organization = {
    id: 'org-first',
    name: 'First',
    slug: 'first',
    subscriptionStatus: 'active',
    planType: 'starter',
    theme: { preset: 'neon-pink' },
    createdAt: '2026-01-01',
};
const second: Organization = { ...first, id: 'org-second', name: 'Second', slug: 'second', theme: { preset: 'custom', hex: '#1155cc' }, createdAt: '2026-02-01' };

test('dashboard bootstrap uses the selected organization and its theme', () => {
    const session = dashboardSessionFromMemberships([
        member('org-first', first, '2026-01-01'),
        member('org-second', second, '2026-02-01'),
    ], 'org-second');
    assert.equal(session.organization?.id, 'org-second');
    assert.deepEqual(session.theme, { preset: 'custom', hex: '#1155cc' });
    assert.equal(session.memberships.length, 2);
});

test('dashboard bootstrap falls back to the oldest membership', () => {
    const session = dashboardSessionFromMemberships([
        member('org-first', first, '2026-01-01'),
        member('org-second', second, '2026-02-01'),
    ], 'missing');
    assert.equal(session.organization?.id, 'org-first');
    assert.deepEqual(session.theme, { preset: 'neon-pink' });
});

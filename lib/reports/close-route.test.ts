import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloseHandler } from './close-route';
import { pickSessionOrganization } from './session-org';

test('the close route ignores a browser organization id and redacts failures', async () => {
    let loaded: string | null = null;
    const handler = createCloseHandler({
        enabled: () => true,
        authorize: async () => ({ ok: true, organizationId: 'org-a', role: 'member' }),
        load: async organizationId => {
            loaded = organizationId;
            return { ok: false, status: 500, error: 'relation secret_token does not exist' };
        },
        now: () => new Date('2026-10-09T18:00:00.000Z'),
    });
    const response = await handler(new Request('http://local/api/reports/close?month=2026-09&orgId=org-b&clientId=other'));
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(loaded, 'org-a');
    assert.equal(body.error, 'Could not load the close board.');
    assert.equal(JSON.stringify(body).includes('secret_token'), false);
    assert.equal(JSON.stringify(body).includes('org-b'), false);
});

test('a missing flag is a 404 and the default month is the previous Pacific month', async () => {
    const hidden = createCloseHandler({
        enabled: () => false,
        authorize: async () => ({ ok: true, organizationId: 'org-a', role: 'owner' }),
        load: async () => { throw new Error('no'); },
        now: () => new Date(),
    });
    const missing = await hidden(new Request('http://local/api/reports/close'));
    assert.equal(missing.status, 404);

    let month = '';
    const handler = createCloseHandler({
        enabled: () => true,
        authorize: async () => ({ ok: false, status: 401, error: 'nope' }),
        load: async (_org, requested) => {
            month = requested;
            return { ok: false, status: 500, error: 'x' };
        },
        now: () => new Date('2026-10-09T18:00:00.000Z'),
    });
    const unauthorized = await handler(new Request('http://local/api/reports/close?orgId=org-b'));
    assert.equal(unauthorized.status, 401);
    assert.equal(month, '');
    const invalid = await createCloseHandler({
        enabled: () => true,
        authorize: async () => ({ ok: true, organizationId: 'org-a', role: 'member' }),
        load: async (_org, requested) => {
            month = requested;
            return { ok: false, status: 503, error: 'column kind does not exist' };
        },
        now: () => new Date('2026-10-09T18:00:00.000Z'),
    })(new Request('http://local/api/reports/close?month=2026-09'));
    assert.equal(month, '2026-09');
    const body = await invalid.json();
    assert.equal(invalid.status, 503);
    assert.equal(body.error, 'The close board is not available yet.');
    assert.equal(JSON.stringify(body).includes('kind'), false);

    const bad = await createCloseHandler({
        enabled: () => true,
        authorize: async () => { throw new Error('should not authorize'); },
        load: async () => { throw new Error('should not load'); },
        now: () => new Date('2026-10-09T18:00:00.000Z'),
    })(new Request('http://local/api/reports/close?month=September'));
    assert.equal(bad.status, 400);
});

test('a selected organization is used only when it is one of the session memberships', () => {
    const members = [
        { organizationId: 'first', role: 'owner' },
        { organizationId: 'second', role: 'member' },
    ];
    assert.equal(pickSessionOrganization(members, 'org-from-the-browser')?.organizationId, 'first');
    assert.equal(pickSessionOrganization(members, 'second')?.organizationId, 'second');
    assert.equal(pickSessionOrganization([], 'second'), null);
});

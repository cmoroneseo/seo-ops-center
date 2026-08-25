import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimesheetTeamGet, type TeamRouteDependencies } from './team-route.ts';
import type { LedgerLog } from './ledger.ts';

function log(overrides: Partial<LedgerLog> & { id: string; date: string }): LedgerLog {
    return {
        organizationId: 'org-1',
        clientId: 'client-a',
        clientName: 'Client A',
        taskId: 'task-1',
        taskTitle: 'On-page fixes',
        userId: 'user-carlos',
        hours: 1,
        description: '',
        countsTowardBudget: true,
        status: 'logged',
        source: 'seo_pm',
        importStatus: 'mapped',
        ...overrides,
    };
}

function harness(options: { role?: 'owner' | 'admin' | 'member' | 'viewer' } = {}) {
    const queried: unknown[] = [];
    const role = options.role ?? 'owner';

    const dependencies: TeamRouteDependencies = {
        now: () => '2026-08-26T12:00:00Z',
        async authorize() {
            return {
                ok: true,
                userId: 'user-carlos',
                organizationId: 'org-1',
                role,
                isManager: role === 'owner' || role === 'admin',
            };
        },
        async listLogs(scope) {
            queried.push(scope);
            return [log({ id: 'a', date: '2026-08-24' })];
        },
        async listMembers() {
            return [
                { userId: 'user-carlos', displayName: 'Carlos Morones' },
                { userId: 'user-abel', displayName: 'Abel Miranda' },
            ];
        },
    };

    return { queried, get: createTimesheetTeamGet(dependencies) };
}

function url(params: Record<string, string> = {}) {
    const search = new URLSearchParams({ organizationId: 'org-1', ...params });
    return new Request(`https://seo-pm.test/api/timesheets/team?${search}`);
}

test('a manager gets every member row for the week', async () => {
    const { get } = harness();
    const response = await get(url({ weekStart: '2026-08-23' }));

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.summary.members.length, 2);
    assert.equal(payload.summary.totals.totalMinutes, 60);
});

test('a member is refused the team view entirely', async () => {
    const { get, queried } = harness({ role: 'member' });
    const response = await get(url());

    assert.equal(response.status, 403);
    assert.deepEqual(queried, []);
});

test('a viewer is refused the team view', async () => {
    const { get } = harness({ role: 'viewer' });

    assert.equal((await get(url())).status, 403);
});

test('the team query is org-scoped and never filtered to one user', async () => {
    const { get, queried } = harness();
    await get(url({ weekStart: '2026-08-23' }));

    assert.deepEqual(queried[0], {
        organizationId: 'org-1',
        userId: null,
        from: '2026-08-23',
        to: '2026-08-29',
    });
});

test('a malformed week is rejected', async () => {
    const { get } = harness();

    assert.equal((await get(url({ weekStart: 'this-week' }))).status, 400);
});

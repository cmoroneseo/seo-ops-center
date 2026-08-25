import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimesheetLedgerGet, type LedgerRouteDependencies } from './ledger-route.ts';
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

function harness(options: {
    role?: 'owner' | 'admin' | 'member' | 'viewer';
    authorized?: boolean;
    logs?: LedgerLog[];
} = {}) {
    const queried: { organizationId: string; userId: string | null; from: string; to: string }[] = [];
    const role = options.role ?? 'member';

    const dependencies: LedgerRouteDependencies = {
        now: () => '2026-08-26T12:00:00Z',
        async authorize() {
            return options.authorized === false
                ? { ok: false, status: 403, error: 'Forbidden' }
                : {
                    ok: true,
                    userId: 'user-carlos',
                    organizationId: 'org-1',
                    role,
                    isManager: role === 'owner' || role === 'admin',
                };
        },
        async listLogs(scope) {
            queried.push(scope);
            return options.logs ?? [log({ id: 'a', date: '2026-08-24' })];
        },
    };

    return { queried, get: createTimesheetLedgerGet(dependencies) };
}

function url(params: Record<string, string> = {}) {
    const search = new URLSearchParams({ organizationId: 'org-1', ...params });
    return new Request(`https://seo-pm.test/api/timesheets/ledger?${search}`);
}

async function body(response: Response) {
    return await response.json() as Record<string, any>;
}

test('a member gets their own week without asking for it', async () => {
    const { get, queried } = harness();
    const response = await get(url());

    assert.equal(response.status, 200);
    const payload = await body(response);
    assert.equal(payload.ledger.weekStart, '2026-08-23');
    assert.equal(payload.userId, 'user-carlos');
    assert.equal(queried[0].userId, 'user-carlos');
});

test('a member cannot read another member’s ledger', async () => {
    const { get, queried } = harness();
    const response = await get(url({ userId: 'user-abel' }));

    assert.equal(response.status, 403);
    assert.deepEqual(queried, []);
});

test('a manager can read another member’s ledger', async () => {
    const { get, queried } = harness({ role: 'owner' });
    const response = await get(url({ userId: 'user-abel' }));

    assert.equal(response.status, 200);
    assert.equal((await body(response)).userId, 'user-abel');
    assert.equal(queried[0].userId, 'user-abel');
});

test('a manager can read the whole team ledger', async () => {
    const { get, queried } = harness({ role: 'admin' });
    const response = await get(url({ scope: 'team' }));

    assert.equal(response.status, 200);
    assert.equal(queried[0].userId, null);
});

test('a member asking for the team scope is refused', async () => {
    const { get, queried } = harness();
    const response = await get(url({ scope: 'team' }));

    assert.equal(response.status, 403);
    assert.deepEqual(queried, []);
});

test('an explicit week is honored and snapped to its Sunday', async () => {
    const { get, queried } = harness();
    const response = await get(url({ weekStart: '2026-08-26' }));

    assert.equal((await body(response)).ledger.weekStart, '2026-08-23');
    assert.equal(queried[0].from, '2026-08-23');
    assert.equal(queried[0].to, '2026-08-29');
});

test('a malformed week is rejected rather than silently defaulted', async () => {
    const { get } = harness();

    assert.equal((await get(url({ weekStart: 'last-week' }))).status, 400);
    assert.equal((await get(url({ weekStart: '08/23/2026' }))).status, 400);
});

test('the query window never exceeds the requested week', async () => {
    const { get, queried } = harness();
    await get(url({ weekStart: '2026-08-23' }));

    assert.deepEqual(queried[0], {
        organizationId: 'org-1',
        userId: 'user-carlos',
        from: '2026-08-23',
        to: '2026-08-29',
    });
});

test('an unauthorized caller never reaches the data layer', async () => {
    const { get, queried } = harness({ authorized: false });
    const response = await get(url());

    assert.equal(response.status, 403);
    assert.deepEqual(queried, []);
});

test('totals are derived server-side so the UI cannot disagree with the ledger', async () => {
    const { get } = harness({
        logs: [
            log({ id: 'a', date: '2026-08-24', hours: 2 }),
            log({ id: 'b', date: '2026-08-25', hours: 1, countsTowardBudget: false }),
        ],
    });

    const payload = await body(await get(url()));
    assert.equal(payload.ledger.totals.totalMinutes, 180);
    assert.equal(payload.ledger.totals.budgetMinutes, 120);
    assert.equal(payload.ledger.totals.nonBudgetMinutes, 60);
});

test('individual entries ship with the grid for the inspector', async () => {
    const { get } = harness({
        logs: [
            log({ id: 'a', date: '2026-08-24', description: 'Title tags' }),
            log({ id: 'b', date: '2026-08-25', source: 'basecamp' }),
        ],
    });

    const payload = await body(await get(url()));
    assert.deepEqual(payload.entries.map((entry: LedgerLog) => entry.id), ['a', 'b']);
    assert.equal(payload.entries[0].description, 'Title tags');
    assert.equal(payload.entries[1].source, 'basecamp');
});

test('entries excluded from the grid are not leaked alongside it', async () => {
    const { get } = harness({
        logs: [
            log({ id: 'shown', date: '2026-08-24' }),
            log({ id: 'running', date: '2026-08-24', status: 'in_progress' }),
            log({ id: 'outside', date: '2026-09-10' }),
        ],
    });

    const payload = await body(await get(url()));
    assert.deepEqual(payload.entries.map((entry: LedgerLog) => entry.id), ['shown']);
});

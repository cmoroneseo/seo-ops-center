import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMirror, INFO_TAB, ROADMAP_TAB, TASKS_TAB, type TaskRow } from './model';
import { assertAppSheetTarget, writeMirror } from './sheets';
import { createMirrorStore } from './store';
import { mirrorEnabled, runMirrorCron, runMirrorQueue, signMirrorMessage, syncClientSheet, verifyMirrorMessage, type MirrorMessage } from './run';
import { runManualMirror } from './manual';

const now = new Date('2026-11-20T02:30:00Z');
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const client = { id, organization_id: 'org', roadmap_sheet_id: 'sheet' };
const task: TaskRow = {
    id: 'parent', title: '=2+2', parent_task_id: null, category: 'seo', stage: 'draft', status: 'done',
    start_date: '2026-11-18T18:00:00Z', due_date: '2026-11-19', completed_at: now.toISOString(),
    published_url: 'https://example.test', basecamp_project_id: 20, basecamp_todo_id: 30,
};
const initiative = {
    id: 'one', title: 'Audit', roadmap_phase: 'month_1' as const, roadmap_included: true,
    sort_order: 3, step_key: 'technical', status: 'todo', priority: 'high', due_date: '2026-11-19',
    task_id: 'parent', updated_at: now.toISOString(),
};

const excluded = [
    'description', 'assignee_id', 'assignee_ids', 'watcher_ids', 'estimated_hours', 'scheduled_minutes',
    'blocked_reason', 'custom_fields', 'status_history', 'bot_key_id', 'bot_operation_id',
    'basecamp_sync_state', 'basecamp_sync_error', 'basecamp_sync_attempted_at', 'import_key', 'comments',
    'reviewer_notes', 'generation_metadata', 'notes', 'seo_hours', 'campaign_total_hours', 'avg_deal_value',
    'time_logs', 'time_log_segments', 'rates', 'budgets',
];

test('mirror columns, roadmap phase and sort order, parent-first tasks, PT dates and exclusions', () => {
    const privateFields = Object.fromEntries(excluded.map(key => [key, `private:${key}`]));
    const { tabs } = buildMirror({
        now, basecampAccountId: '10',
        roadmap: [
            { ...initiative, ...privateFields },
            { ...initiative, title: 'Omit', roadmap_included: false },
            { ...initiative, title: 'Setup', roadmap_phase: 'onboarding', sort_order: 8 },
            { ...initiative, title: 'Earlier', sort_order: 1 },
            { ...initiative, title: 'Later', roadmap_phase: null },
        ],
        tasks: [
            { ...task, id: 'child', title: 'Child', parent_task_id: 'parent', basecamp_todo_id: null },
            { ...task, ...privateFields },
        ],
    });
    assert.deepEqual(tabs.map(tab => tab.title), [ROADMAP_TAB, TASKS_TAB, INFO_TAB]);
    assert.deepEqual(tabs[0].rows[0], ['Phase', 'Initiative', 'Category', 'Status', 'Priority', 'Due date',
        'Linked task status', 'Last updated', 'App ID']);
    assert.deepEqual(tabs[0].rows.slice(1).map(row => row[1]), ['Setup', 'Earlier', 'Audit', 'Later']);
    assert.deepEqual(tabs[0].rows[3], ['Month 1', 'Audit', 'Technical SEO', 'todo', 'high',
        '2026-11-19', 'done', '2026-11-19', 'one']);
    assert.deepEqual(tabs[1].rows[0], ['Title', 'Parent task', 'Category', 'Stage', 'Status', 'Start date',
        'Due date', 'Completed date', 'Published URL', 'Basecamp link', 'App ID']);
    assert.deepEqual(tabs[1].rows[1], ['=2+2', '', 'seo', 'draft', 'done', '2026-11-18',
        '2026-11-19', '2026-11-19', 'https://example.test', 'https://3.basecamp.com/10/buckets/20/todos/30', 'parent']);
    assert.equal(tabs[1].rows[2][1], '=2+2');
    assert.equal(tabs[1].rows[2][9], '');
    assert.match(tabs[2].rows[1][1], /Nov 19, 2026.*6:30:00 PM PT/);
    assert.deepEqual(tabs[2].rows.slice(2, 5).map(row => row[1]), ['4', '2', '5']);
    assert.match(tabs[2].rows.at(-1)![1], /Edit in the app, not here/);
    assert.ok(tabs.every(tab => tab.rows.every(row => row.every(cell => typeof cell === 'string'))));
    const output = JSON.stringify(tabs);
    for (const field of excluded) assert.ok(!output.includes(field));
});

test('database queries use explicit allowlists and scope data to the client organization', async () => {
    const calls: string[][] = [];
    const store = createMirrorStore({
        from(table: string) {
            const log = [table];
            calls.push(log);
            const chain = {
                select(columns: string) { log.push(columns); return chain; },
                eq(key: string, value: unknown) { log.push(`${key}=${value}`); return chain; },
                order() { return chain; },
                range() { return chain; },
                async returns() { return { data: [], error: null }; },
                async maybeSingle() { return { data: client, error: null }; },
            };
            return chain;
        },
    } as unknown as Parameters<typeof createMirrorStore>[0]);
    await store.loadClient(id, 'org');
    await store.loadData(client);
    assert.deepEqual(calls.map(([table]) => table), ['clients', 'marketing_plan_items', 'tasks']);
    for (const [, columns, ...filters] of calls) {
        const selected = columns.split(',');
        assert.ok(!selected.includes('*'));
        for (const field of excluded) assert.ok(!selected.includes(field));
        assert.ok(filters.includes('organization_id=org'));
        assert.ok(filters.includes(`id=${id}`) || filters.includes(`client_id=${id}`));
    }
});

test('guard rejects team tab titles, ranges and mixed targets before accessing Google', async () => {
    for (const value of ['Roadmap', 'App - Roadmap', "'App – Roadmap'", 'App – Roadmap\n']) {
        assert.throws(() => assertAppSheetTarget(value), /App – tab/);
    }
    for (const value of ['Content Plan!A1', "'Roadmap'!A1", "'App – Roadmap'!A1,'Roadmap'!A1"]) {
        assert.throws(() => assertAppSheetTarget(value, 'range'), /App – tab/);
    }
    assertAppSheetTarget(ROADMAP_TAB);
    for (const value of [`'${ROADMAP_TAB}'`, `'${ROADMAP_TAB}'!A1`]) assertAppSheetTarget(value, 'range');
    await assert.rejects(writeMirror('sheet', [{ title: 'Roadmap', rows: [] }], {
        serviceAccountEmail: 'svc@example.test', fetch: async () => assert.fail('unexpected fetch'),
        getToken: async () => assert.fail('unexpected token exchange'),
    }), /App – tab/);
});

const tabs = buildMirror({ now, roadmap: [], tasks: [task] }).tabs;
const sheets = [
    [1, 'Roadmap'], [2, 'Content Plan'], [3, ROADMAP_TAB], [4, `${ROADMAP_TAB} (prev)`],
    [5, 'Roadmap (prev)'], [6, 'App – Other (prev)'], [7, INFO_TAB],
].map(([sheetId, title]) => ({ properties: { sheetId, title, gridProperties: { rowCount: 10, columnCount: 14 } } }));

test('snapshot and resize app tabs, hide App IDs on existing and new tabs, then write raw strings', async () => {
    const calls: { url: string; body: Record<string, unknown> | undefined }[] = [];
    await writeMirror('sheet', tabs, {
        serviceAccountEmail: 'svc@example.test',
        getToken: async () => 'mock-token',
        async fetch(url, init) {
            assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer mock-token');
            calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
            return Response.json({ sheets });
        },
    });
    assert.deepEqual(calls.map(({ url }) => url.split('spreadsheets/sheet')[1]),
        ['?fields=sheets.properties', ':batchUpdate', '/values:batchClear', '/values:batchUpdate']);
    const writes = calls.slice(1).map(call => call.body);
    assert.deepEqual(writes[0]?.requests, [
        { deleteSheet: { sheetId: 4 } },
        { duplicateSheet: { sourceSheetId: 3, newSheetId: 8, newSheetName: `${ROADMAP_TAB} (prev)` } },
        { updateSheetProperties: { properties: { sheetId: 3, gridProperties: { rowCount: 10, columnCount: 14, frozenRowCount: 1 } },
            fields: 'gridProperties(frozenRowCount,rowCount,columnCount)' } },
        { updateDimensionProperties: {
            range: { sheetId: 3, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 },
            properties: { hiddenByUser: true }, fields: 'hiddenByUser',
        } },
        { addSheet: { properties: { sheetId: 9, title: TASKS_TAB, gridProperties: { rowCount: 2, columnCount: 11, frozenRowCount: 1 } } } },
        { updateDimensionProperties: {
            range: { sheetId: 9, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 },
            properties: { hiddenByUser: true }, fields: 'hiddenByUser',
        } },
        { duplicateSheet: { sourceSheetId: 7, newSheetId: 10, newSheetName: `${INFO_TAB} (prev)` } },
        { updateSheetProperties: { properties: { sheetId: 7, gridProperties: { rowCount: 10, columnCount: 14, frozenRowCount: 1 } },
            fields: 'gridProperties(frozenRowCount,rowCount,columnCount)' } },
    ]);
    assert.deepEqual(writes[1]?.ranges, tabs.map(tab => `'${tab.title}'`));
    assert.deepEqual(writes[2], {
        valueInputOption: 'RAW',
        data: tabs.map(tab => ({ range: `'${tab.title}'!A1`, values: tab.rows })),
    });
});

test('Sheets retries a 429 using Retry-After and a 503 with exponential backoff', async () => {
    const delays: number[] = [];
    let calls = 0;
    await writeMirror('sheet', tabs, {
        serviceAccountEmail: 'svc@example.test', getToken: async () => 'token', random: () => 0,
        sleep: async delay => { delays.push(delay); },
        async fetch() {
            calls++;
            if (calls === 1) return new Response(null, { status: 429, headers: { 'Retry-After': '6' } });
            if (calls === 2) return new Response(null, { status: 503 });
            return Response.json({ sheets });
        },
    });
    assert.equal(calls, 6);
    assert.deepEqual(delays, [6000, 2000]);
});

test('permission and missing-sheet responses make one request with clear errors', async () => {
    for (const [status, message] of [[403, 'Share the sheet with svc@example.test as Editor'], [404, 'Sheet not found']] as const) {
        let calls = 0;
        await assert.rejects(writeMirror('sheet', tabs, {
            serviceAccountEmail: 'svc@example.test', getToken: async () => 'token',
            sleep: async () => assert.fail('fatal errors must not retry'),
            async fetch() { calls++; return new Response(null, { status }); },
        }), { message });
        assert.equal(calls, 1);
    }
});

const auth = { ok: true, role: 'member', userId: 'actor', organizationId: 'org', clientId: id, actorName: 'Actor' } as const;
const unexpected = async (): Promise<never> => assert.fail('unexpected service call');
const chain = { chainId: other, index: 0, clients: [id, other] };
const store = {
    loadClient: async () => client,
    reserve: async () => 'reserved' as const,
    loadData: async () => ({ tasks: [task], roadmap: [initiative] }),
    finish: unexpected,
};

test('kill switch is exact and cron, queue and manual paths never call services when off', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', unexpected);
    for (const value of [undefined, 'false', 'True', ' true ', '1']) assert.equal(mirrorEnabled({ SHEETS_MIRROR_ENABLED: value }), false);
    assert.equal(mirrorEnabled({ SHEETS_MIRROR_ENABLED: 'true' }), true);
    assert.deepEqual(await runMirrorCron({ enabled: false, listClients: unexpected, publish: unexpected }),
        { skipped: true, reason: 'Sheet mirror is off' });
    await runMirrorQueue(chain, { enabled: false, sync: unexpected, publish: unexpected });
    await runMirrorQueue({ ...chain, clients: ['bad-id'] }, { enabled: true, sync: unexpected, publish: unexpected });
    const response = await runManualMirror(id, { enabled: false, authorize: async () => auth, sync: unexpected });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'Sheet mirror is off');
    assert.deepEqual(await syncClientSheet(id, {
        enabled: false, now: () => now, trigger: 'cron', store: { ...store, loadClient: unexpected }, write: unexpected,
    }), { status: 'skipped', reason: 'disabled' });
    assert.equal(fetch.mock.callCount(), 0);
});

test('cron enqueues only the first client and every queue step processes one client', async () => {
    const messages: MirrorMessage[] = [];
    const publish = async (message: MirrorMessage) => { messages.push(message); };
    assert.deepEqual(await runMirrorCron({ enabled: true, listClients: async () => [id, other], publish }),
        { enqueued: 1, clients: 2 });
    assert.equal(messages.length, 1);
    const signed = signMirrorMessage(messages[0], 'cron-secret');
    assert.deepEqual(verifyMirrorMessage(signed, 'cron-secret'), messages[0]);
    assert.equal(verifyMirrorMessage(messages[0], 'cron-secret'), null);
    assert.equal(verifyMirrorMessage({ ...signed, index: 1 }, 'cron-secret'), null);
    assert.equal(verifyMirrorMessage(signed, 'different-secret'), null);
    const synced: string[] = [];
    const sync = async (clientId: string) => { synced.push(clientId); };
    await runMirrorQueue(messages[0], { enabled: true, sync, publish });
    assert.deepEqual(synced, [id]);
    assert.equal(messages[1].index, 1);
    await runMirrorQueue(messages[1], { enabled: true, sync, publish });
    assert.deepEqual(synced, [id, other]);
    assert.equal(messages.length, 2);
});

test('the queue publishes the next client when sync throws', async (t) => {
    const log = t.mock.method(console, 'error', () => {});
    const messages: MirrorMessage[] = [];
    await runMirrorQueue(chain, {
        enabled: true,
        async sync(clientId) {
            assert.equal(clientId, id);
            throw new Error('internal database details');
        },
        async publish(message) { messages.push(message); },
    });
    assert.deepEqual(messages, [{ ...chain, index: 1 }]);
    assert.deepEqual(log.mock.calls.map(call => call.arguments), [['Client sheet mirror sync failed']]);
});

test('sync logs success and failure, and a client without a saved sheet skips all writes', async () => {
    const expectedCounts = { [ROADMAP_TAB]: 1, [TASKS_TAB]: 1, [INFO_TAB]: 5 };
    for (const error of [null, 'Sheet not found']) {
        const synced: unknown[] = [];
        const logged: unknown[] = [];
        const result = await syncClientSheet(id, {
            enabled: true, now: () => now, trigger: 'cron', runId: other,
            store: { ...store, async finish(...args) { logged.push(args); } },
            async write(sheetId, tabs) {
                synced.push(sheetId, tabs.length);
                if (error) throw new Error(error);
            },
        });
        assert.deepEqual(synced, ['sheet', 3]);
        const status = error ? 'failed' : 'succeeded';
        const rowsWritten = error ? {} : expectedCounts;
        assert.deepEqual(result, { status, rowsWritten, error });
        assert.deepEqual(logged, [[other, { status, rows_written: rowsWritten, error, finished_at: now.toISOString() }]]);
    }
    assert.deepEqual(await syncClientSheet(id, {
        enabled: true, now: () => now, trigger: 'cron', write: unexpected,
        store: { ...store, reserve: unexpected, loadClient: async () => ({ ...client, roadmap_sheet_id: null }) },
    }), { status: 'skipped', reason: 'missing_sheet' });
});

test('manual sync rejects a viewer and returns 429 on a rate-limited reservation', async () => {
    const viewer = await runManualMirror(id, {
        enabled: true, authorize: async () => ({ ...auth, role: 'viewer' }), sync: unexpected,
    });
    assert.equal(viewer.status, 403);
    const limited = await runManualMirror(id, {
        enabled: true, authorize: async () => auth,
        sync: (clientId, organizationId, requestedBy) => syncClientSheet(clientId, {
            enabled: true, now: () => now, trigger: 'manual', organizationId, requestedBy,
            store: { ...store, async reserve(_id, selectedClient, trigger, actor) {
                assert.deepEqual([selectedClient, trigger, actor], [client, 'manual', 'actor']);
                return 'rate_limited';
            } },
            write: unexpected,
        }),
    });
    assert.equal(limited.status, 429);
});

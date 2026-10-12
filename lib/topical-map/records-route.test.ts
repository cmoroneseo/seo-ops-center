import test from 'node:test';
import assert from 'node:assert/strict';

import { createRecordsHandlers, type RecordContext, type RecordsRouteDeps, type SiloContext } from './records-route.ts';

const org = '06e536b9-beac-49bc-8c96-1df021102590';
const other = '11111111-1111-4111-8111-111111111111';
const client = 'cbba5b14-7e24-4913-b396-0fff7fb2df17';
const siloId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mapId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const recordId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const silo: SiloContext = { id: siloId, mapId, organizationId: org, clientId: client, archived: false };
const current: RecordContext = {
    id: recordId, siloId, mapId, organizationId: org, clientId: client,
    wordCountMin: 1100, wordCountMax: 1600, archived: false,
};

function storedRow(row: Record<string, unknown>) {
    return {
        id: recordId,
        created_at: '2026-10-12T00:00:00.000Z',
        updated_at: '2026-10-12T00:00:00.000Z',
        status: 'pending',
        page_type: 'other',
        action: 'create',
        title: 'New page',
        target_query: '',
        word_count_min: 0,
        word_count_max: 0,
        build_phase: 1,
        scope_exclusions: [],
        outgoing_links: [],
        sort_order: 0,
        ...row,
    };
}

function handlers(overrides: Partial<RecordsRouteDeps> = {}) {
    const calls = { inserted: [] as Record<string, unknown>[], updated: [] as Record<string, unknown>[] };
    const deps: RecordsRouteDeps = {
        enabled: () => true,
        authorize: async clientId => clientId === client
            ? { ok: true, organizationId: org, clientId: client, role: 'member' }
            : { ok: false, status: 401, error: 'Unauthorized' },
        loadSilo: async id => id === siloId ? silo : null,
        loadRecord: async id => id === recordId ? current : null,
        nextSortOrder: async () => 3,
        insertRecord: async row => {
            calls.inserted.push(row);
            return { row: storedRow(row) };
        },
        updateSpec: async (_id, _organizationId, row) => {
            calls.updated.push(row);
            return { row: storedRow({ silo_id: siloId, map_id: mapId, organization_id: org, ...row }) };
        },
        ...overrides,
    };
    return { api: createRecordsHandlers(deps), calls };
}

const post = (body: unknown) => new Request('https://app.test/api/topical-map/records', {
    method: 'POST',
    body: JSON.stringify(body),
});

test('the spec flag hides manual add and still answers the enabled check', async () => {
    const off = handlers({ enabled: () => false });
    const created = await off.api.post(post({ clientId: client, siloId, title: 'New page' }));
    assert.equal(created.status, 404);
    assert.equal(off.calls.inserted.length, 0);
    const status = await off.api.get(new Request(`https://app.test/api/topical-map/records?clientId=${client}`));
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { enabled: false });
    const on = handlers();
    const enabled = await on.api.get(new Request(`https://app.test/api/topical-map/records?clientId=${client}`));
    assert.deepEqual(await enabled.json(), { enabled: true });
    assert.equal((await on.api.get(new Request('https://app.test/api/topical-map/records'))).status, 401);
});

test('a manual record is pending, marked manual, and ignores a client organization id', async () => {
    const { api, calls } = handlers();
    const response = await api.post(post({
        clientId: client,
        siloId,
        title: 'Marketing ROI formula',
        targetQuery: 'marketing roi formula',
        organizationId: other,
        source: 'gsc',
        status: 'approved',
    }));
    assert.equal(response.status, 200);
    const body = await response.json() as { record: { source: string; status: string; title: string } };
    assert.equal(body.record.source, 'manual');
    assert.equal(body.record.status, 'pending');
    assert.equal(body.record.title, 'Marketing ROI formula');
    assert.equal(calls.inserted[0].organization_id, org);
    assert.equal(calls.inserted[0].source, 'manual');
    assert.equal(calls.inserted[0].status, 'pending');
    assert.equal('task_id' in calls.inserted[0], false);
});

test('viewers, other silos, and a 61-word answer do not write', async () => {
    const viewer = handlers({
        authorize: async () => ({ ok: true, organizationId: org, clientId: client, role: 'viewer' }),
    });
    assert.equal((await viewer.api.post(post({ clientId: client, siloId, title: 'New page' }))).status, 403);
    assert.equal(viewer.calls.inserted.length, 0);

    const { api, calls } = handlers();
    assert.equal((await api.post(post({
        clientId: client,
        siloId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        title: 'New page',
    }))).status, 404);
    const tooLong = await api.post(post({
        clientId: client,
        siloId,
        title: 'New page',
        answerFirst60: Array.from({ length: 61 }, (_, index) => `word${index}`).join(' '),
    }));
    assert.equal(tooLong.status, 400);
    assert.match((await tooLong.json() as { error: string }).error, /60 words/);
    assert.equal((await api.post(post({ clientId: client, siloId, title: '   ' }))).status, 400);
    assert.equal(calls.inserted.length, 0);
});

test('a spec edit saves the answer and cannot approve or relabel the source', async () => {
    const { api, calls } = handlers();
    const response = await api.patch(post({
        clientId: client,
        recordId,
        answerFirst60: 'Spend divided by attributed revenue.',
        status: 'approved',
        source: 'gsc',
        taskId: 'task-1',
    }));
    assert.equal(response.status, 200);
    assert.equal(calls.updated[0].answer_first_60, 'Spend divided by attributed revenue.');
    assert.equal('status' in calls.updated[0], false);
    assert.equal('source' in calls.updated[0], false);
    assert.equal('task_id' in calls.updated[0], false);
    assert.equal((await api.patch(post({ clientId: client, recordId, status: 'declined' }))).status, 400);
    assert.equal(calls.updated.length, 1);

    const conflict = await api.patch(post({ clientId: client, recordId, wordCountMin: 5000 }));
    assert.equal(conflict.status, 400);
    assert.match((await conflict.json() as { error: string }).error, /minimum cannot be above/);

    const archived = handlers({
        loadRecord: async () => ({ ...current, archived: true }),
    });
    const blocked = await archived.api.patch(post({ clientId: client, recordId, uniqueAngle: 'A vertical, not a calculator.' }));
    assert.equal(blocked.status, 409);
    assert.equal(archived.calls.updated.length, 0);
});

test('a missing spec column tells the AM to apply migration 083', async () => {
    const { api } = handlers({
        insertRecord: async () => ({ row: null, missingColumn: true }),
    });
    const response = await api.post(post({ clientId: client, siloId, title: 'New page' }));
    assert.equal(response.status, 503);
    assert.match((await response.json() as { error: string }).error, /migration 083/);
});

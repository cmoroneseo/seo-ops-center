import test from 'node:test';
import assert from 'node:assert/strict';

import { createContentHandlers, type ContentRecordContext, type ContentRouteDeps } from './route.ts';
import type { TopicalMapRecord } from '../types.ts';

const org = '06e536b9-beac-49bc-8c96-1df021102590';
const client = 'cbba5b14-7e24-4913-b396-0fff7fb2df17';
const recordId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function record(overrides: Partial<TopicalMapRecord> = {}): TopicalMapRecord {
    return {
        id: recordId,
        siloId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        mapId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        organizationId: org,
        pageType: 'blog_post',
        action: 'create',
        title: 'Marketing ROI formula',
        targetQuery: 'marketing roi',
        wordCountMin: 0,
        wordCountMax: 0,
        buildPhase: 1,
        scopeExclusions: [],
        outgoingLinks: [],
        status: 'pending',
        sortOrder: 0,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        ...overrides,
    };
}

function storedRow(page: TopicalMapRecord, row: Record<string, unknown>) {
    return {
        id: page.id,
        silo_id: page.siloId,
        map_id: page.mapId,
        organization_id: page.organizationId,
        page_type: page.pageType,
        action: page.action,
        title: page.title,
        target_query: page.targetQuery,
        word_count_min: page.wordCountMin,
        word_count_max: page.wordCountMax,
        build_phase: page.buildPhase,
        scope_exclusions: page.scopeExclusions,
        outgoing_links: page.outgoingLinks,
        status: page.status,
        task_id: page.taskId ?? null,
        production_status: page.productionStatus ?? null,
        work_month: page.workMonth ?? null,
        sort_order: page.sortOrder,
        created_at: page.createdAt,
        updated_at: page.updatedAt,
        ...row,
    };
}

function handlers(page = record(), role: 'member' | 'viewer' = 'member') {
    const calls = { tasks: 0, updates: [] as Record<string, unknown>[] };
    let current = page;
    const deps: ContentRouteDeps = {
        authorize: async clientId => clientId === client
            ? { ok: true, userId: 'user-1', actorName: 'Carlos', organizationId: org, clientId: client, role }
            : { ok: false, status: 401, error: 'Unauthorized' },
        loadRecord: async id => id === recordId
            ? { record: current, clientId: client, organizationId: org, archived: false } satisfies ContentRecordContext
            : null,
        updateRecord: async (_id, _organizationId, row) => {
            calls.updates.push(row);
            current = {
                ...current,
                status: typeof row.status === 'string' ? row.status as TopicalMapRecord['status'] : current.status,
                taskId: typeof row.task_id === 'string' ? row.task_id : current.taskId,
                workMonth: 'work_month' in row ? (row.work_month as string | null) : current.workMonth,
                productionStatus: 'production_status' in row
                    ? row.production_status as TopicalMapRecord['productionStatus']
                    : current.productionStatus,
            };
            return { row: storedRow(current, row) };
        },
        createTask: async () => {
            calls.tasks += 1;
            return { ok: true, taskId: `task-${calls.tasks}` };
        },
    };
    return { api: createContentHandlers(deps), calls, read: () => current };
}

const post = (body: unknown) => new Request('https://app.test/api/content/records', {
    method: 'POST',
    body: JSON.stringify(body),
});

test('approving twice keeps the first task and still saves the month', async () => {
    const { api, calls, read } = handlers();
    const first = await api.approve(post({ clientId: client, recordId, workMonth: '2026-11' }));
    assert.equal(first.status, 200);
    const created = await first.json() as { taskId: string; record: { status: string; workMonth: string } };
    assert.equal(created.taskId, 'task-1');
    assert.equal(created.record.status, 'approved');
    assert.equal(created.record.workMonth, '2026-11');
    assert.equal(calls.tasks, 1);
    assert.equal(calls.updates[0].task_id, 'task-1');
    assert.equal(calls.updates[0].work_month, '2026-11');
    assert.equal(read().taskId, 'task-1');

    const second = await api.approve(post({ clientId: client, recordId, workMonth: '2026-12' }));
    assert.equal(second.status, 200);
    const reused = await second.json() as { taskId: string; record: { workMonth: string; taskId?: string } };
    assert.equal(reused.taskId, 'task-1');
    assert.equal(reused.record.workMonth, '2026-12');
    assert.equal(reused.record.taskId, 'task-1');
    assert.equal(calls.tasks, 1);
    assert.equal(calls.updates[1].task_id, 'task-1');
});

test('a bad month does not create a task, and going over the plan is not a server error', async () => {
    const { api, calls } = handlers();
    const bad = await api.approve(post({ clientId: client, recordId, workMonth: 'November' }));
    assert.equal(bad.status, 400);
    assert.match((await bad.json() as { error: string }).error, /real month/);
    assert.equal(calls.tasks, 0);
    assert.equal(calls.updates.length, 0);

    const over = await api.approve(post({ clientId: client, recordId, workMonth: '2026-11', limit: 0 }));
    assert.equal(over.status, 200);
    assert.equal(calls.tasks, 1);
});

test('viewers cannot approve or move a page', async () => {
    const viewer = handlers(record(), 'viewer');
    const approved = await viewer.api.approve(post({ clientId: client, recordId, workMonth: '2026-11' }));
    assert.equal(approved.status, 403);
    assert.match((await approved.json() as { error: string }).error, /view this content/);
    const moved = await viewer.api.update(post({ clientId: client, recordId, workMonth: '2026-12' }));
    assert.equal(moved.status, 403);
    assert.equal(viewer.calls.tasks, 0);
    assert.equal(viewer.calls.updates.length, 0);

    const member = handlers(record({ status: 'approved', taskId: 'task-9', productionStatus: 'writing' }));
    const status = await member.api.update(post({
        clientId: client,
        recordId,
        productionStatus: 'client_review',
        workMonth: '2026-11',
    }));
    assert.equal(status.status, 200);
    const body = await status.json() as { record: { productionStatus: string; status: string; workMonth: string } };
    assert.equal(body.record.productionStatus, 'client_review');
    assert.equal(body.record.status, 'approved');
    assert.equal(body.record.workMonth, '2026-11');
    assert.equal(member.calls.tasks, 0);
    assert.equal(member.calls.updates[0].status, 'approved');
    assert.equal('task_id' in member.calls.updates[0], false);

    const live = await member.api.update(post({ clientId: client, recordId, productionStatus: 'already_live' }));
    assert.equal(live.status, 400);
    assert.match((await live.json() as { error: string }).error, /not already on the site/);
});

test('approving again after the status was reset reuses the linked task', async () => {
    const { api, calls, read } = handlers();
    const first = await api.approve(post({ clientId: client, recordId, workMonth: '2026-11' }));
    assert.equal(first.status, 200);
    assert.equal(calls.tasks, 1);

    const reset = await api.update(post({ clientId: client, recordId, productionStatus: 'not_written' }));
    assert.equal(reset.status, 200);
    assert.equal(read().status, 'pending');
    assert.equal(read().taskId, 'task-1');

    const declined = await api.update(post({ clientId: client, recordId, productionStatus: 'declined' }));
    assert.equal(declined.status, 200);
    assert.equal(read().status, 'declined');

    const again = await api.approve(post({ clientId: client, recordId, workMonth: '2026-12' }));
    assert.equal(again.status, 200);
    const body = await again.json() as { taskId: string; record: { status: string; workMonth: string } };
    assert.equal(body.taskId, 'task-1');
    assert.equal(body.record.status, 'approved');
    assert.equal(body.record.workMonth, '2026-12');
    assert.equal(calls.tasks, 1);
});

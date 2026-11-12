import test from 'node:test';
import assert from 'node:assert/strict';

import {
    approveContentRecord,
    bulkFailureMessage,
    declineContentRecord,
    renameContentRecord,
    reopenContentRecord,
    runBulk,
} from './client.ts';
import { createContentHandlers, type ContentRouteDeps } from './route.ts';
import type { TopicalMapRecord } from '../types.ts';

const org = '06e536b9-beac-49bc-8c96-1df021102590';
const client = 'cbba5b14-7e24-4913-b396-0fff7fb2df17';
const ids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
];

function record(id: string, overrides: Partial<TopicalMapRecord> = {}): TopicalMapRecord {
    return {
        id,
        siloId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        mapId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        organizationId: org,
        pageType: 'blog_post',
        action: 'create',
        title: `Idea ${id.slice(0, 4)}`,
        targetQuery: 'some search',
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

function toRow(page: TopicalMapRecord): Record<string, unknown> {
    return {
        id: page.id,
        silo_id: page.siloId,
        map_id: page.mapId,
        organization_id: page.organizationId,
        page_type: page.pageType,
        action: page.action,
        title: page.title,
        target_query: page.targetQuery,
        build_phase: page.buildPhase,
        scope_exclusions: [],
        outgoing_links: [],
        status: page.status,
        task_id: page.taskId ?? null,
        production_status: page.productionStatus ?? null,
        work_month: page.workMonth ?? null,
        sort_order: page.sortOrder,
        created_at: page.createdAt,
        updated_at: page.updatedAt,
    };
}

/**
 * Wire the browser helpers in lib/content/client.ts to the real content
 * route handlers, so a bulk run goes through the same authorization and
 * approval code as production.
 */
function server(role: 'member' | 'viewer') {
    const pages = new Map(ids.map(id => [id, record(id)]));
    const calls = { tasks: 0, updates: 0 };
    const deps: ContentRouteDeps = {
        authorize: async clientId => clientId === client
            ? { ok: true, userId: 'user-1', actorName: 'Carlos', organizationId: org, clientId: client, role }
            : { ok: false, status: 401, error: 'Unauthorized' },
        loadRecord: async id => {
            const page = pages.get(id);
            return page ? { record: page, clientId: client, organizationId: org, archived: false } : null;
        },
        updateRecord: async (id, _organizationId, row) => {
            calls.updates += 1;
            const current = pages.get(id);
            if (!current) return { row: null };
            const next: TopicalMapRecord = {
                ...current,
                title: typeof row.title === 'string' ? row.title : current.title,
                status: typeof row.status === 'string' ? row.status as TopicalMapRecord['status'] : current.status,
                taskId: typeof row.task_id === 'string' ? row.task_id : current.taskId,
                workMonth: 'work_month' in row ? row.work_month as string | null : current.workMonth,
                productionStatus: 'production_status' in row
                    ? row.production_status as TopicalMapRecord['productionStatus']
                    : current.productionStatus,
            };
            pages.set(id, next);
            return { row: toRow(next) };
        },
        createTask: async () => {
            calls.tasks += 1;
            return { ok: true, taskId: `task-${calls.tasks}` };
        },
    };
    const handlers = createContentHandlers(deps);
    const statuses: number[] = [];
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
        const request = new Request('https://app.test/api/content/records', { method: init?.method, body: init?.body });
        const response = init?.method === 'POST' ? await handlers.approve(request) : await handlers.update(request);
        statuses.push(response.status);
        return response;
    }) as typeof fetch;
    return { pages, calls, statuses, fetcher };
}

async function withFetch<T>(fetcher: typeof fetch, run: () => Promise<T>): Promise<T> {
    const original = globalThis.fetch;
    globalThis.fetch = fetcher;
    try {
        return await run();
    } finally {
        globalThis.fetch = original;
    }
}

test('bulk approve approves every selected idea for the chosen month, one task each', async () => {
    const { pages, calls, fetcher } = server('member');
    const result = await withFetch(fetcher, () =>
        runBulk(ids, id => approveContentRecord({ clientId: client, recordId: id, workMonth: '2026-12' })));
    assert.equal(result.failed.length, 0);
    assert.equal(result.saved.length, 3);
    for (const id of ids) {
        assert.equal(pages.get(id)?.status, 'approved');
        assert.equal(pages.get(id)?.workMonth, '2026-12');
        assert.equal(pages.get(id)?.productionStatus, 'approved');
    }
    assert.equal(calls.tasks, 3);
    assert.equal(bulkFailureMessage(result, 'approve'), null);
});

test('bulk approve run twice reuses the linked tasks', async () => {
    const { calls, fetcher } = server('member');
    await withFetch(fetcher, () => runBulk(ids, id => approveContentRecord({ clientId: client, recordId: id, workMonth: '2026-11' })));
    await withFetch(fetcher, () => runBulk(ids, id => approveContentRecord({ clientId: client, recordId: id, workMonth: '2026-11' })));
    assert.equal(calls.tasks, 3);
});

test('bulk decline declines every selected idea; restore puts it back to waiting', async () => {
    const { pages, fetcher } = server('member');
    const result = await withFetch(fetcher, () => runBulk(ids.slice(0, 2), id => declineContentRecord({ clientId: client, recordId: id })));
    assert.equal(result.saved.length, 2);
    assert.equal(pages.get(ids[0])?.status, 'declined');
    assert.equal(pages.get(ids[1])?.status, 'declined');
    assert.equal(pages.get(ids[2])?.status, 'pending');

    const restored = await withFetch(fetcher, () => reopenContentRecord({ clientId: client, recordId: ids[0] }));
    assert.equal(restored.record?.status, 'pending');
    assert.equal(pages.get(ids[0])?.productionStatus, 'not_written');
});

test('a viewer gets a 403 on bulk approve, bulk decline and title edits, and nothing changes', async () => {
    const { pages, calls, statuses, fetcher } = server('viewer');
    const approved = await withFetch(fetcher, () =>
        runBulk(ids, id => approveContentRecord({ clientId: client, recordId: id, workMonth: '2026-11' })));
    const declined = await withFetch(fetcher, () => runBulk(ids, id => declineContentRecord({ clientId: client, recordId: id })));
    const renamed = await withFetch(fetcher, () => renameContentRecord({ clientId: client, recordId: ids[0], title: 'New title' }));

    assert.deepEqual(statuses, Array(7).fill(403));
    assert.equal(approved.saved.length, 0);
    assert.equal(approved.failed.length, 3);
    assert.equal(declined.failed.length, 3);
    assert.equal(renamed.record, null);
    assert.equal(renamed.error, 'You can view this content, not change it.');
    assert.equal(
        bulkFailureMessage(approved, 'approve'),
        'Could not approve the 3 selected ideas. You can view this content, not change it.',
    );
    assert.equal(calls.tasks, 0);
    assert.equal(calls.updates, 0);
    for (const id of ids) assert.equal(pages.get(id)?.status, 'pending');
    assert.equal(pages.get(ids[0])?.title, `Idea ${ids[0].slice(0, 4)}`);
});

test('a member can fix a title through the content route; an empty title is refused', async () => {
    const { pages, fetcher } = server('member');
    const renamed = await withFetch(fetcher, () => renameContentRecord({ clientId: client, recordId: ids[0], title: '  Bridge or implant:   which is right for you?  ' }));
    assert.equal(renamed.record?.title, 'Bridge or implant: which is right for you?');
    assert.equal(pages.get(ids[0])?.status, 'pending');
    const empty = await withFetch(fetcher, () => renameContentRecord({ clientId: client, recordId: ids[0], title: '   ' }));
    assert.equal(empty.error, 'Add a title.');
});

test('a partly failed bulk run says how many landed', () => {
    const message = bulkFailureMessage({
        saved: [record(ids[0])],
        failed: [{ id: ids[1], error: 'Could not save this page.' }],
    }, 'decline');
    assert.equal(message, '1 saved, 1 could not be declined. Could not save this page.');
});

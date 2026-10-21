import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildRelinkParents,
    relinkBasecampChildren,
    type BasecampRelinkDependencies,
    type RelinkLogLine,
    type RelinkSnapshot,
} from './basecamp-relink-route.ts';
import type { BasecampNestDependencies, BasecampRecording } from './basecamp-nest.ts';
import type { SessionOrganization } from '../reports/session-org.ts';

const org = '06e536b9-beac-49bc-8c96-1df021102590';
const clientId = 'cbba5b14-7e24-4913-b396-0fff7fb2df17';
const parentId = '208dbc36-1111-4111-8111-111111111111';
const otherParentId = '208dbc36-2222-4222-8222-222222222222';
const childId = '208dbc36-3333-4333-8333-333333333333';
const nestedId = '208dbc36-4444-4444-8444-444444444444';

function session(role: 'owner' | 'admin' | 'member' | 'viewer'): SessionOrganization {
    return { ok: true, userId: 'user-1', organizationId: org, role };
}

function snapshot(): RelinkSnapshot {
    return {
        clientId,
        projectId: '48599958',
        claimedRecordingIds: ['77', '100', '101', '88'],
        parents: [
            {
                id: parentId,
                basecampTodoId: '77',
                children: [
                    { id: childId, title: 'Houzz', basecampTodoId: '100', pendingTrashId: null },
                    { id: nestedId, title: 'Yelp', basecampTodoId: '101', pendingTrashId: null },
                ],
            },
            {
                id: otherParentId,
                basecampTodoId: '88',
                children: [
                    { id: '208dbc36-5555-4555-8555-555555555555', title: 'GBP', basecampTodoId: '102', pendingTrashId: null },
                ],
            },
        ],
    };
}

function nesting(recordings: Record<string, BasecampRecording>) {
    const calls: string[] = [];
    const dependencies: BasecampNestDependencies = {
        now: () => '2026-10-21T20:00:00.000Z',
        store: {
            async linkTodo(taskId, _projectId, recordingId, _at, pendingTrashId) {
                calls.push(`link:${taskId}:${recordingId}:${pendingTrashId ?? ''}`);
            },
            async clearPendingTrash(taskId) {
                calls.push(`clear:${taskId}`);
            },
        },
        provider: {
            async inspectRecording(input) {
                calls.push(`inspect:${input.recordingId}`);
                return { ok: true, recording: recordings[input.recordingId] ?? { kind: 'missing' } };
            },
            async listSteps() {
                calls.push('list-steps');
                return { ok: true, steps: [] };
            },
            async createStep(input) {
                calls.push(`create-step:${input.parentTodoId}:${input.title}`);
                return { ok: true, id: input.parentTodoId === '77' ? '200' : '201' };
            },
            async trashRecording(input) {
                calls.push(`trash:${input.recordingId}`);
                return { ok: true, alreadyGone: false };
            },
        },
    };
    return { dependencies, calls };
}

function deps(options: {
    role?: 'owner' | 'admin' | 'member' | 'viewer';
    session?: SessionOrganization;
    loaded?: RelinkSnapshot | { ok: false; status: 400 | 404; error: string };
    recordings?: Record<string, BasecampRecording>;
} = {}) {
    const logs: RelinkLogLine[] = [];
    const loadedOrganizations: string[] = [];
    const nest = nesting(options.recordings ?? {
        '77': { kind: 'todo', trashed: false },
        '88': { kind: 'todo', trashed: false },
        '100': { kind: 'todo', trashed: false },
        '101': { kind: 'step', parentTodoId: '77', trashed: false },
        '102': { kind: 'todo', trashed: false },
    });
    const dependencies: BasecampRelinkDependencies = {
        session: async () => options.session ?? session(options.role ?? 'admin'),
        async load(organizationId, _clientId, parentTaskId) {
            loadedOrganizations.push(organizationId);
            if (options.loaded && !('projectId' in options.loaded)) return options.loaded;
            const full = options.loaded ?? snapshot();
            const parents = parentTaskId
                ? full.parents.filter(parent => parent.id === parentTaskId)
                : full.parents;
            return { ok: true, snapshot: { ...full, parents } };
        },
        nesting: () => nest.dependencies,
        log: line => {
            logs.push(line);
        },
    };
    return { dependencies, logs, calls: nest.calls, loadedOrganizations };
}

const dryBody = { clientId, parentTaskId: parentId, dryRun: true, organizationId: '11111111-1111-4111-8111-111111111111' };

test('a member, a viewer, and a signed-out user cannot relink', async () => {
    for (const role of ['member', 'viewer'] as const) {
        const { dependencies, calls, loadedOrganizations } = deps({ role });
        const result = await relinkBasecampChildren(dryBody, dependencies);
        assert.equal(result.status, 403);
        assert.equal(loadedOrganizations.length, 0);
        assert.equal(calls.length, 0);
    }
    const signedOut = deps({ session: { ok: false, status: 401, error: 'Unauthorized' } });
    const refused = await relinkBasecampChildren(dryBody, signedOut.dependencies);
    assert.equal(refused.status, 401);
    assert.equal(signedOut.calls.length, 0);
});

test('dryRun is required and a client outside the organization is not found', async () => {
    const missingFlag = deps();
    const bad = await relinkBasecampChildren({ clientId, parentTaskId: parentId }, missingFlag.dependencies);
    assert.equal(bad.status, 400);
    assert.equal(missingFlag.calls.length, 0);

    const missingClient = deps({ loaded: { ok: false, status: 404, error: 'Not found' } });
    const result = await relinkBasecampChildren(dryBody, missingClient.dependencies);
    assert.equal(result.status, 404);
    assert.deepEqual(missingClient.loadedOrganizations, [org]);
    assert.equal(missingClient.calls.length, 0);
});

test('dry run lists what it would create and trash and does not write', async () => {
    const { dependencies, calls, logs } = deps();
    const result = await relinkBasecampChildren(dryBody, dependencies);
    assert.equal(result.status, 200);
    if (result.status !== 200) return;
    const body = result.body as { dryRun: boolean; parentTaskId: string; results: RelinkLogLine[] };
    assert.equal(body.dryRun, true);
    assert.equal(body.parentTaskId, parentId);
    assert.equal(body.results.length, 2);
    assert.equal(logs.length, 2);
    const flat = body.results.find(line => line.taskId === childId);
    const nested = body.results.find(line => line.taskId === nestedId);
    assert.equal(flat?.action, 'would-nest');
    assert.deepEqual(flat?.create, { kind: 'step', title: 'Houzz', parentTodoId: '77' });
    assert.equal(flat?.trashRecordingId, '100');
    assert.equal(nested?.action, 'already-nested');
    assert.equal(calls.some(call => call.startsWith('create-')), false);
    assert.equal(calls.some(call => call.startsWith('link:')), false);
    assert.equal(calls.some(call => call.startsWith('trash:')), false);
    assert.equal(body.results.some(line => line.taskId.endsWith('555555555555')), false);
});

test('a real run for one parent creates the step, saves it, then trashes the old to-do', async () => {
    const { dependencies, calls, logs } = deps({ role: 'owner' });
    const result = await relinkBasecampChildren({
        clientId,
        parentTaskId: parentId,
        dryRun: false,
    }, dependencies);
    assert.equal(result.status, 200);
    const flat = logs.find(line => line.taskId === childId);
    assert.equal(flat?.action, 'nested');
    assert.equal(flat?.dryRun, false);
    assert.equal(flat?.trashRecordingId, '100');
    assert.equal(flat?.linkedRecordingId, '200');
    const linkAt = calls.indexOf('link:208dbc36-3333-4333-8333-333333333333:200:100');
    const trashAt = calls.indexOf('trash:100');
    assert.ok(linkAt > calls.indexOf('create-step:77:Houzz'));
    assert.ok(trashAt > linkAt);
    assert.equal(calls.includes('trash:101'), false);
    assert.equal(calls.some(call => call.includes('GBP')), false);
});

test('a parent that is itself a subtask is refused before Basecamp is called', () => {
    const built = buildRelinkParents([
        {
            id: parentId,
            title: 'Citations',
            parentTaskId: null,
            basecampTodoId: '77',
            pendingTrashId: null,
        },
        {
            id: childId,
            title: 'Houzz',
            parentTaskId: parentId,
            basecampTodoId: '100',
            pendingTrashId: null,
        },
    ], childId);
    assert.equal(built.ok, false);
    if (built.ok) return;
    assert.equal(built.status, 400);
});

test('children are grouped in plan order even when the rows arrive backwards', () => {
    const built = buildRelinkParents([
        {
            id: parentId,
            title: 'Indexing + bloat triage',
            parentTaskId: null,
            basecampTodoId: '10429396134',
            pendingTrashId: null,
        },
        {
            id: '208dbc36-3333-4333-8333-333333333334',
            title: 'Clean the sitemap',
            parentTaskId: parentId,
            basecampTodoId: '44',
            pendingTrashId: null,
            position: 4,
            createdAt: '2026-10-04T00:00:00.000Z',
        },
        {
            id: childId,
            title: 'List duplicate and junk pages',
            parentTaskId: parentId,
            basecampTodoId: '11',
            pendingTrashId: null,
            position: 1,
            createdAt: '2026-10-02T00:00:00.000Z',
        },
        {
            id: nestedId,
            title: 'Pick the main page',
            parentTaskId: parentId,
            basecampTodoId: '22',
            pendingTrashId: null,
            position: 1,
            createdAt: '2026-10-01T00:00:00.000Z',
        },
    ], parentId);
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.deepEqual(built.parents[0]?.children.map(child => child.title), [
        'Pick the main page',
        'List duplicate and junk pages',
        'Clean the sitemap',
    ]);
});

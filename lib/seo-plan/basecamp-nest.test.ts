import assert from 'node:assert/strict';
import test from 'node:test';

import {
    classifyBasecampRecording,
    clearPendingTrashUpdate,
    nestFlatChild,
    pendingTrashMessage,
    readPendingTrashId,
    recordingFromRead,
    relinkChildren,
    taskBasecampLinkUpdate,
    unnestToTodo,
    type BasecampNestDependencies,
    type BasecampRecording,
    type ListedRecording,
    type NestTask,
} from './basecamp-nest.ts';

const at = '2026-10-21T20:00:00.000Z';

function child(overrides: Partial<NestTask> = {}): NestTask {
    return {
        id: 'child-1',
        title: 'Houzz',
        basecampTodoId: '100',
        pendingTrashId: null,
        description: 'Profile',
        dueDate: '2026-10-31',
        assigneePersonIds: [4],
        ...overrides,
    };
}

function harness(options: {
    recordings?: Record<string, BasecampRecording>;
    steps?: ListedRecording[];
    todos?: ListedRecording[];
    createStep?: () => Promise<{ ok: true; id: string } | { ok: false; status: number; message: string; scope: 'task' }>;
    trash?: (id: string) => Promise<{ ok: true; alreadyGone: boolean } | { ok: false; status: number; message: string; scope: 'task' }>;
    link?: () => Promise<void>;
    reopenTodo?: () => Promise<{ ok: true } | { ok: false; status: number; message: string; scope: 'task' }>;
    completeStep?: () => Promise<{ ok: true } | { ok: false; status: number; message: string; scope: 'task' }>;
    completeTodo?: () => Promise<{ ok: true } | { ok: false; status: number; message: string; scope: 'task' }>;
} = {}) {
    const calls: string[] = [];
    const recordings = options.recordings ?? { '100': { kind: 'todo', trashed: false } };
    let steps = options.steps ?? [];
    const todos = options.todos ?? [];
    let nextStep = 200;
    const dependencies: BasecampNestDependencies = {
        now: () => at,
        store: {
            async linkTodo(taskId, _projectId, recordingId, _at, pendingTrashId) {
                calls.push(`link:${taskId}:${recordingId}:${pendingTrashId ?? ''}`);
                if (options.link) await options.link();
            },
            async clearPendingTrash(taskId) {
                calls.push(`clear:${taskId}`);
            },
        },
        provider: {
            async inspectRecording(input) {
                calls.push(`inspect:${input.recordingId}`);
                const recording = recordings[input.recordingId];
                if (recording) return { ok: true, recording };
                if (input.recordingId === '77') return { ok: true, recording: { kind: 'todo', trashed: false } };
                return { ok: true, recording: { kind: 'missing' } };
            },
            async listSteps() {
                calls.push('list-steps');
                return { ok: true, steps };
            },
            async listTodos() {
                calls.push('list-todos');
                return { ok: true, todos };
            },
            async createStep(input) {
                calls.push(`create-step:${input.title}`);
                if (options.createStep) return options.createStep();
                const id = String(nextStep);
                nextStep += 1;
                steps = [...steps, { id, title: input.title }];
                recordings[id] = { kind: 'step', parentTodoId: input.parentTodoId, trashed: false };
                return { ok: true, id };
            },
            async createTodo(input) {
                calls.push(`create-todo:${input.title}`);
                const id = '300';
                recordings[id] = { kind: 'todo', trashed: false };
                return { ok: true, id };
            },
            async completeStep(input) {
                calls.push(`complete-step:${input.stepId}`);
                if (options.completeStep) return options.completeStep();
                const recording = recordings[input.stepId];
                if (recording && recording.kind === 'step') recording.completed = true;
                return { ok: true };
            },
            async completeTodo(input) {
                calls.push(`complete-todo:${input.todoId}`);
                if (options.completeTodo) return options.completeTodo();
                const recording = recordings[input.todoId];
                if (recording && recording.kind === 'todo') recording.completed = true;
                return { ok: true };
            },
            async reopenTodo(input) {
                calls.push(`reopen:${input.todoId}`);
                if (options.reopenTodo) return options.reopenTodo();
                const recording = recordings[input.todoId];
                if (recording && recording.kind === 'todo') recording.completed = false;
                return { ok: true };
            },
            async trashRecording(input) {
                calls.push(`trash:${input.recordingId}`);
                if (options.trash) return options.trash(input.recordingId);
                return { ok: true, alreadyGone: false };
            },
        },
    };
    return { dependencies, calls, recordings };
}

test('a to-do, a step, a trashed to-do, and a 404 are different recordings', () => {
    assert.deepEqual(classifyBasecampRecording({
        id: 9,
        type: 'Todo',
        status: 'active',
        parent: { id: 3, type: 'Todolist' },
        content: 'Citations',
    }), { kind: 'todo', trashed: false, completed: false });
    assert.deepEqual(classifyBasecampRecording({
        id: 5,
        type: 'Kanban::Step',
        status: 'active',
        completed: true,
        parent: { id: 9, type: 'Todo' },
        title: 'Houzz',
    }), { kind: 'step', parentTodoId: '9', trashed: false, completed: true });
    assert.deepEqual(classifyBasecampRecording({
        id: 9,
        type: 'Todo',
        status: 'trashed',
        completed: true,
        parent: { id: 3, type: 'Todolist' },
    }), { kind: 'todo', trashed: true, completed: true });
    assert.deepEqual(recordingFromRead(404, null), { kind: 'missing' });
    assert.deepEqual(classifyBasecampRecording({ id: 1, type: 'Comment' }), { kind: 'unknown' });
    assert.equal(readPendingTrashId(pendingTrashMessage('100')), '100');
    assert.equal(readPendingTrashId('Basecamp returned 422.'), null);
});

test('the link write saves the new id and the recording still to trash together', () => {
    const update = taskBasecampLinkUpdate({
        projectId: '48599958',
        todoId: '200',
        at,
        pendingTrashId: '100',
    });
    assert.equal(update.basecamp_todo_id, 200);
    assert.equal(update.basecamp_project_id, 48599958);
    assert.equal(readPendingTrashId(String(update.basecamp_sync_error)), '100');
    assert.equal(update.basecamp_sync_state, 'failed');
    const plain = taskBasecampLinkUpdate({ projectId: '48599958', todoId: '200', at });
    assert.equal(Object.hasOwn(plain, 'basecamp_sync_error'), false);
    assert.equal(clearPendingTrashUpdate(at).basecamp_sync_error, null);
    assert.equal(clearPendingTrashUpdate(at).basecamp_sync_state, 'ok');
});

test('a flat to-do becomes a subtask, and the old to-do is trashed only after the step is saved', async () => {
    const task = child();
    const { dependencies, calls } = harness();
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        child: task,
        claimed: new Set(['100', '77']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'nested');
    assert.deepEqual(result.create, { kind: 'step', title: 'Houzz', parentTodoId: '77' });
    assert.equal(result.trashRecordingId, '100');
    assert.equal(result.linkedRecordingId, '200');
    assert.equal(task.basecampTodoId, '200');
    assert.equal(task.pendingTrashId, null);
    const linkAt = calls.indexOf('link:child-1:200:100');
    const trashAt = calls.indexOf('trash:100');
    assert.ok(linkAt > calls.indexOf('create-step:Houzz'));
    assert.ok(trashAt > linkAt);
    assert.ok(calls.indexOf('clear:child-1') > trashAt);
});

test('dry run lists the step it would create and the to-do it would trash without writing', async () => {
    const { dependencies, calls } = harness();
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        child: child(),
        claimed: new Set(['100']),
        dryRun: true,
    }, dependencies);
    assert.equal(result.action, 'would-nest');
    assert.deepEqual(result.create, { kind: 'step', title: 'Houzz', parentTodoId: '77' });
    assert.equal(result.trashRecordingId, '100');
    assert.equal(result.linkedRecordingId, null);
    assert.deepEqual(calls, ['inspect:100', 'inspect:77', 'list-steps']);
    assert.equal(result.completion.childCompleted, false);
    assert.equal(result.completion.willCompleteStep, false);
    assert.equal(result.completion.parentTodoCompleted, false);
    assert.equal(result.completion.reopenParent, false);
});

test('a failure while creating the step does not trash the old to-do', async () => {
    const { dependencies, calls } = harness({
        createStep: async () => ({ ok: false, status: 422, message: 'Basecamp returned 422.', scope: 'task' }),
    });
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        child: child(),
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'failed');
    assert.equal(result.status, 422);
    assert.equal(calls.includes('trash:100'), false);
    assert.equal(calls.some(call => call.startsWith('link:')), false);
});

test('a failure while saving the new step id does not trash the old to-do', async () => {
    const { dependencies, calls } = harness({
        link: async () => {
            throw new Error('database unavailable');
        },
    });
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        child: child(),
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'failed');
    assert.match(result.message ?? '', /not saved/);
    assert.equal(calls.includes('trash:100'), false);
    assert.equal(calls.includes('create-step:Houzz'), true);
});

test('a trash failure after the step is saved does not create a second step on retry', async () => {
    const task = child();
    let trashCalls = 0;
    const first = harness({
        trash: async () => {
            trashCalls += 1;
            return { ok: false, status: 500, message: 'Basecamp returned 500.', scope: 'task' };
        },
    });
    const failed = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        child: task,
        claimed: new Set(['100']),
        dryRun: false,
    }, first.dependencies);
    assert.equal(failed.action, 'failed');
    assert.equal(readPendingTrashId(failed.message), '100');
    assert.equal(task.basecampTodoId, '200');
    assert.equal(task.pendingTrashId, '100');
    assert.equal(first.calls.includes('clear:child-1'), false);
    assert.equal(trashCalls, 1);

    const second = harness({
        recordings: {
            '200': { kind: 'step', parentTodoId: '77', trashed: false },
            '100': { kind: 'todo', trashed: false },
        },
    });
    const retried = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        child: task,
        claimed: new Set(['200']),
        dryRun: false,
    }, second.dependencies);
    assert.equal(retried.action, 'finished-trash');
    assert.equal(retried.trashRecordingId, '100');
    assert.equal(second.calls.includes('create-step:Houzz'), false);
    assert.equal(second.calls.includes('list-steps'), false);
    assert.deepEqual(second.calls, ['inspect:200', 'trash:100', 'clear:child-1']);
    assert.equal(task.pendingTrashId, null);
});

test('a retry reuses the unsaved step instead of creating another', async () => {
    const { dependencies, calls } = harness({
        steps: [{ id: '200', title: 'Houzz' }],
    });
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        child: child(),
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'nested');
    assert.equal(result.reusedRecordingId, '200');
    assert.equal(result.create, null);
    assert.equal(calls.includes('create-step:Houzz'), false);
    assert.equal(calls.includes('link:child-1:200:100'), true);
    assert.equal(calls.includes('trash:100'), true);
});

test('two unclaimed steps with the same title are not guessed at', async () => {
    const { dependencies, calls } = harness({
        steps: [{ id: '200', title: 'Houzz' }, { id: '201', title: 'Houzz' }],
    });
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        child: child(),
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'failed');
    assert.match(result.message ?? '', /More than one/);
    assert.equal(calls.includes('create-step:Houzz'), false);
    assert.equal(calls.some(call => call.startsWith('trash:')), false);
});

test('a child whose old to-do 404s still gets a subtask and nothing is trashed', async () => {
    const { dependencies, calls } = harness({
        recordings: { '100': { kind: 'missing' } },
    });
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        child: child(),
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'nested');
    assert.equal(result.trashRecordingId, null);
    assert.match(result.message ?? '', /already missing/);
    assert.equal(calls.some(call => call.startsWith('trash:')), false);
    assert.equal(calls.includes('link:child-1:200:'), true);
});

test('a child whose old to-do is already trashed still gets a subtask and nothing is trashed', async () => {
    const { dependencies, calls } = harness({
        recordings: { '100': { kind: 'todo', trashed: true } },
    });
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        child: child(),
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'nested');
    assert.equal(result.trashRecordingId, null);
    assert.match(result.message ?? '', /already trashed/);
    assert.equal(calls.some(call => call.startsWith('trash:')), false);
});

test('trashing an old to-do that returns 404 still counts as nested', async () => {
    const { dependencies, calls } = harness({
        trash: async () => ({ ok: true, alreadyGone: true }),
    });
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        child: child(),
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'nested');
    assert.match(result.message ?? '', /already gone/);
    assert.equal(calls.includes('trash:100'), true);
    assert.equal(calls.includes('clear:child-1'), true);
});

test('a step that already sits under the parent is left alone', async () => {
    const { dependencies, calls } = harness({
        recordings: { '100': { kind: 'step', parentTodoId: '77', trashed: false } },
    });
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        child: child(),
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'already-nested');
    assert.deepEqual(calls, ['inspect:100', 'inspect:77']);
});

test('a step under a different to-do is recreated under the new parent and the old step is trashed', async () => {
    const { dependencies, calls } = harness({
        recordings: { '100': { kind: 'step', parentTodoId: '55', trashed: false } },
    });
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        child: child(),
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'nested');
    assert.equal(result.trashRecordingId, '100');
    assert.equal(calls.includes('create-step:Houzz'), true);
    assert.equal(calls.includes('trash:100'), true);
});

test('an unclassified recording is not trashed', async () => {
    const { dependencies, calls } = harness({
        recordings: { '100': { kind: 'unknown' } },
    });
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        child: child(),
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'failed');
    assert.match(result.message ?? '', /did not say/);
    assert.equal(calls.some(call => call.startsWith('trash:')), false);
    assert.equal(calls.some(call => call.startsWith('link:')), false);
});

test('moving a step back to the top level creates a to-do, saves it, then trashes the step', async () => {
    const task = child({ basecampTodoId: '100' });
    const { dependencies, calls } = harness({
        recordings: { '100': { kind: 'step', parentTodoId: '77', trashed: false } },
    });
    const result = await unnestToTodo({
        projectId: '48599958',
        parentTodoId: null,
        parentTaskId: null,
        todolistId: '9001',
        child: task,
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'unnested');
    assert.equal(result.trashRecordingId, '100');
    assert.equal(result.linkedRecordingId, '300');
    assert.equal(task.basecampTodoId, '300');
    const linkAt = calls.indexOf('link:child-1:300:100');
    const trashAt = calls.indexOf('trash:100');
    assert.ok(linkAt > calls.indexOf('create-todo:Houzz'));
    assert.ok(trashAt > linkAt);
});

test('a live top-level to-do is not replaced when the task is already top-level', async () => {
    const { dependencies, calls } = harness();
    const result = await unnestToTodo({
        projectId: '48599958',
        parentTodoId: null,
        parentTaskId: null,
        todolistId: '9001',
        child: child(),
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'already-top-level');
    assert.deepEqual(calls, ['inspect:100']);
});

test('dry run of a batch lists every child and writes nothing', async () => {
    const { dependencies, calls } = harness({
        recordings: {
            '100': { kind: 'todo', trashed: false },
            '101': { kind: 'step', parentTodoId: '77', trashed: false },
        },
    });
    const results = await relinkChildren({
        projectId: '48599958',
        dryRun: true,
        claimedRecordingIds: ['100', '101', '77'],
        parents: [{
            id: 'parent-1',
            basecampTodoId: '77',
            children: [
                child(),
                child({ id: 'child-2', title: 'Yelp', basecampTodoId: '101' }),
                child({ id: 'child-3', title: 'GBP', basecampTodoId: null }),
            ],
        }, {
            id: 'parent-2',
            basecampTodoId: null,
            children: [child({ id: 'child-4', title: 'Citations', basecampTodoId: '102' })],
        }],
    }, dependencies);
    assert.deepEqual(results.map(result => [result.taskId, result.action, result.trashRecordingId]), [
        ['child-1', 'would-nest', '100'],
        ['child-2', 'already-nested', null],
        ['child-3', 'skipped-unlinked', null],
        ['child-4', 'skipped-no-parent-todo', null],
    ]);
    assert.equal(calls.some(call => call.startsWith('create-')), false);
    assert.equal(calls.some(call => call.startsWith('link:')), false);
    assert.equal(calls.some(call => call.startsWith('trash:')), false);
});

test('a real batch nests one flat child and leaves the step that is already nested', async () => {
    const flat = child();
    const step = child({ id: 'child-2', title: 'Yelp', basecampTodoId: '101' });
    const { dependencies, calls } = harness({
        recordings: {
            '100': { kind: 'todo', trashed: false },
            '101': { kind: 'step', parentTodoId: '77', trashed: false },
        },
    });
    const results = await relinkChildren({
        projectId: '48599958',
        dryRun: false,
        claimedRecordingIds: ['100', '101'],
        parents: [{
            id: 'parent-1',
            basecampTodoId: '77',
            children: [flat, step],
        }],
    }, dependencies);
    assert.equal(results[0]?.action, 'nested');
    assert.equal(results[1]?.action, 'already-nested');
    assert.equal(calls.filter(call => call.startsWith('create-step:')).length, 1);
    assert.equal(calls.includes('trash:100'), true);
    assert.equal(calls.includes('trash:101'), false);
});

const openParent = { kind: 'todo' as const, trashed: false, completed: false };
const doneParent = { kind: 'todo' as const, trashed: false, completed: true };

test('dry run shows completion for a done child under a completed parent and writes nothing', async () => {
    const { dependencies, calls } = harness({
        recordings: {
            '77': doneParent,
            '100': { kind: 'todo', trashed: false, completed: true },
        },
    });
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        parentTaskCompleted: true,
        child: child({ completed: true }),
        claimed: new Set(['100', '77']),
        dryRun: true,
    }, dependencies);
    assert.equal(result.action, 'would-nest');
    assert.deepEqual(result.completion, {
        childCompleted: true,
        willCompleteStep: true,
        parentTodoCompleted: true,
        reopenParent: true,
        recompleteParent: true,
    });
    assert.match(result.message ?? '', /Child is completed/);
    assert.equal(calls.some(call => call.startsWith('reopen:')), false);
    assert.equal(calls.some(call => call.startsWith('complete-')), false);
    assert.equal(calls.some(call => call.startsWith('create-')), false);
    assert.equal(calls.some(call => call.startsWith('trash:')), false);
    assert.equal(calls.some(call => call.startsWith('link:')), false);
});

test('a completed parent is reopened, the step is completed, the parent is completed again, then the old to-do is trashed', async () => {
    const task = child({ completed: true });
    const { dependencies, calls } = harness({
        recordings: {
            '77': { ...doneParent },
            '100': { kind: 'todo', trashed: false, completed: true },
        },
    });
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        parentTaskCompleted: true,
        child: task,
        claimed: new Set(['100', '77']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'nested');
    assert.equal(result.completion.willCompleteStep, true);
    assert.equal(result.completion.reopenParent, true);
    const reopenAt = calls.indexOf('reopen:77');
    const createAt = calls.indexOf('create-step:Houzz');
    const linkAt = calls.indexOf('link:child-1:200:100');
    const stepAt = calls.indexOf('complete-step:200');
    const parentAt = calls.indexOf('complete-todo:77');
    const trashAt = calls.indexOf('trash:100');
    assert.ok(reopenAt >= 0 && createAt > reopenAt);
    assert.ok(linkAt > createAt);
    assert.ok(stepAt > linkAt);
    assert.ok(parentAt > stepAt);
    assert.ok(trashAt > parentAt);
    assert.equal(calls.filter(call => call.startsWith('trash:')).length, 1);
});

test('a create failure after reopening a completed parent completes the parent again and trashes nothing', async () => {
    const { dependencies, calls } = harness({
        recordings: {
            '77': { ...doneParent },
            '100': { kind: 'todo', trashed: false },
        },
        createStep: async () => ({ ok: false, status: 422, message: 'Basecamp returned 422.', scope: 'task' }),
    });
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        child: child(),
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'failed');
    assert.equal(result.status, 422);
    assert.equal(calls.includes('reopen:77'), true);
    assert.equal(calls.includes('complete-todo:77'), true);
    assert.equal(calls.some(call => call.startsWith('link:')), false);
    assert.equal(calls.some(call => call.startsWith('trash:')), false);
    assert.ok(calls.indexOf('complete-todo:77') > calls.indexOf('reopen:77'));
});

test('reopening a completed parent is required before creating a step, and a failed reopen trashes nothing', async () => {
    const { dependencies, calls } = harness({
        recordings: {
            '77': { ...doneParent },
            '100': { kind: 'todo', trashed: false },
        },
        reopenTodo: async () => ({ ok: false, status: 422, message: 'Basecamp returned 422.', scope: 'task' }),
    });
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        child: child(),
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'failed');
    assert.equal(result.status, 422);
    assert.equal(calls.includes('create-step:Houzz'), false);
    assert.equal(calls.some(call => call.startsWith('trash:')), false);
    assert.equal(calls.some(call => call.startsWith('link:')), false);
});

test('a step completion failure after the id is saved does not trash, and the retry completes then trashes', async () => {
    const task = child({ completed: true });
    const parent = { ...openParent };
    const first = harness({
        recordings: {
            '77': parent,
            '100': { kind: 'todo', trashed: false, completed: true },
        },
        completeStep: async () => ({ ok: false, status: 500, message: 'Basecamp returned 500.', scope: 'task' }),
    });
    const failed = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        parentTaskCompleted: true,
        child: task,
        claimed: new Set(['100']),
        dryRun: false,
    }, first.dependencies);
    assert.equal(failed.action, 'failed');
    assert.equal(readPendingTrashId(failed.message), '100');
    assert.equal(task.basecampTodoId, '200');
    assert.equal(first.calls.includes('complete-step:200'), true);
    assert.equal(first.calls.includes('complete-todo:77'), true);
    assert.equal(first.calls.some(call => call.startsWith('trash:')), false);
    assert.equal(first.calls.includes('create-step:Houzz'), true);

    const second = harness({
        recordings: {
            '77': { ...openParent },
            '200': { kind: 'step', parentTodoId: '77', trashed: false, completed: false },
            '100': { kind: 'todo', trashed: false },
        },
    });
    const retried = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        parentTaskCompleted: true,
        child: task,
        claimed: new Set(['200']),
        dryRun: false,
    }, second.dependencies);
    assert.equal(retried.action, 'finished-trash');
    assert.equal(second.calls.includes('create-step:Houzz'), false);
    const stepAt = second.calls.indexOf('complete-step:200');
    const parentAt = second.calls.indexOf('complete-todo:77');
    const trashAt = second.calls.indexOf('trash:100');
    assert.ok(stepAt >= 0 && parentAt > stepAt && trashAt > parentAt);
});

test('a done child that is already a step is completed without creating or trashing, even when the parent to-do is completed', async () => {
    const { dependencies, calls } = harness({
        recordings: {
            '77': { ...doneParent },
            '100': { kind: 'step', parentTodoId: '77', trashed: false, completed: false },
        },
    });
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        parentTaskCompleted: true,
        child: child({ completed: true }),
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'already-nested');
    assert.equal(calls.includes('reopen:77'), true);
    assert.equal(calls.includes('complete-step:100'), true);
    assert.equal(calls.includes('complete-todo:77'), true);
    assert.equal(calls.some(call => call.startsWith('create-')), false);
    assert.equal(calls.some(call => call.startsWith('trash:')), false);
    const reopenAt = calls.indexOf('reopen:77');
    const stepAt = calls.indexOf('complete-step:100');
    const parentAt = calls.indexOf('complete-todo:77');
    assert.ok(stepAt > reopenAt && parentAt > stepAt);
});

test('an open parent task that is done in Basecamp is recompleted after an open child is nested', async () => {
    const { dependencies, calls } = harness({
        recordings: {
            '77': { ...doneParent },
            '100': { kind: 'todo', trashed: false, completed: false },
        },
    });
    const result = await nestFlatChild({
        projectId: '48599958',
        parentTodoId: '77',
        parentTaskId: 'parent-1',
        parentTaskCompleted: false,
        child: child(),
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'nested');
    assert.equal(result.completion.childCompleted, false);
    assert.equal(result.completion.willCompleteStep, false);
    assert.equal(result.completion.reopenParent, true);
    assert.equal(result.completion.recompleteParent, true);
    assert.equal(calls.includes('complete-step:200'), false);
    const reopenAt = calls.indexOf('reopen:77');
    const createAt = calls.indexOf('create-step:Houzz');
    const parentAt = calls.indexOf('complete-todo:77');
    const trashAt = calls.indexOf('trash:100');
    assert.ok(reopenAt >= 0 && createAt > reopenAt && parentAt > createAt && trashAt > parentAt);
});

test('a dry run of a done parent and its done children reports completion on every child', async () => {
    const { dependencies, calls } = harness({
        recordings: {
            '77': doneParent,
            '100': { kind: 'todo', trashed: false, completed: true },
            '101': { kind: 'step', parentTodoId: '77', trashed: false, completed: true },
        },
    });
    const results = await relinkChildren({
        projectId: '48599958',
        dryRun: true,
        claimedRecordingIds: ['77', '100', '101'],
        parents: [{
            id: 'parent-1',
            basecampTodoId: '77',
            completed: true,
            children: [
                child({ completed: true }),
                child({ id: 'child-2', title: 'Yelp', basecampTodoId: '101', completed: true }),
            ],
        }],
    }, dependencies);
    assert.equal(results[0]?.action, 'would-nest');
    assert.equal(results[0]?.completion.childCompleted, true);
    assert.equal(results[0]?.completion.willCompleteStep, true);
    assert.equal(results[0]?.completion.parentTodoCompleted, true);
    assert.equal(results[0]?.completion.reopenParent, true);
    assert.equal(results[1]?.action, 'already-nested');
    assert.equal(results[1]?.completion.childCompleted, true);
    assert.equal(results[1]?.completion.willCompleteStep, false);
    assert.equal(results[1]?.completion.parentTodoCompleted, true);
    assert.equal(results[1]?.completion.reopenParent, false);
    assert.equal(results[1]?.completion.recompleteParent, false);
    assert.equal(calls.some(call => call.startsWith('reopen:')), false);
    assert.equal(calls.some(call => call.startsWith('trash:')), false);
    assert.equal(calls.some(call => call.startsWith('create-')), false);
});

test('lifting a completed step completes the new to-do before the step is trashed', async () => {
    const task = child({ completed: true });
    const { dependencies, calls } = harness({
        recordings: { '100': { kind: 'step', parentTodoId: '77', trashed: false, completed: true } },
    });
    const result = await unnestToTodo({
        projectId: '48599958',
        parentTodoId: null,
        parentTaskId: null,
        todolistId: '9001',
        child: task,
        claimed: new Set(['100']),
        dryRun: false,
    }, dependencies);
    assert.equal(result.action, 'unnested');
    assert.equal(result.carriedCompletion, true);
    assert.equal(result.completion.willCompleteStep, true);
    const linkAt = calls.indexOf('link:child-1:300:100');
    const completeAt = calls.indexOf('complete-todo:300');
    const trashAt = calls.indexOf('trash:100');
    assert.ok(linkAt >= 0 && completeAt > linkAt && trashAt > completeAt);
});

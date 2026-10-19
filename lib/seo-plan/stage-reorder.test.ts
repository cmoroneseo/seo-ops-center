import assert from 'node:assert/strict';
import test from 'node:test';

import { groupTasksByStage, type StageListTask } from './stage-list.ts';
import {
    applyStageReorder,
    describeStageDrop,
    mergeStageTasks,
    restoreStageTasks,
    STAGE_REORDER_ONE_LEVEL,
    STAGE_REORDER_PILLAR,
    STAGE_REORDER_RECURRING,
    STAGE_REORDER_SELF,
    stageMoveBy,
} from './stage-reorder.ts';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'onboarding',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

const tasks: StageListTask[] = [
    task({ id: 'setup', title: 'SEO Setup', position: 1 }),
    task({ id: 'keywords', title: 'Add keywords', position: 1, parentTaskId: 'setup' }),
    task({ id: 'cookies', title: 'Set Up Empire Cookies', position: 2, parentTaskId: 'setup' }),
    task({ id: 'roadmap', title: 'Create SEO Roadmap', position: 2 }),
    task({ id: 'robots', title: 'Review robots.txt', stage: 'backlog', position: 1 }),
    task({ id: 'https', title: 'Check HTTPS', stage: 'backlog', position: 2 }),
    task({ id: 'later', title: 'Monthly report', stage: 'backlog', position: 3, parentTaskId: 'done', recurring: true }),
];

function order(list: readonly StageListTask[], stage: string, parentId: string | null = null): string[] {
    const section = groupTasksByStage(list, '').find(item => item.stage === stage);
    if (!section) return [];
    if (!parentId) return section.groups.map(group => group.task.id);
    return section.groups.find(group => group.task.id === parentId)?.children.map(child => child.id) ?? [];
}

function plan(move: Parameters<typeof applyStageReorder>[1], source: readonly StageListTask[] = tasks) {
    const result = applyStageReorder(source, move);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('expected a plan');
    return result;
}

test('reordering inside a stage packs that stage and leaves the others', () => {
    const result = plan({ taskId: 'https', stage: 'backlog', parentTaskId: null, index: 0 });
    assert.deepEqual(order(result.tasks, 'backlog'), ['https', 'robots', 'later']);
    assert.deepEqual(order(result.tasks, 'onboarding'), ['setup', 'roadmap']);
    assert.deepEqual(result.writes.map(write => [write.id, write.position, write.stage, write.parentTaskId]), [
        ['https', 1, 'backlog', null],
        ['robots', 2, 'backlog', null],
    ]);
    assert.equal(result.writes.some(write => write.id === 'setup' || write.id === 'later'), false);
});

test('moving a task to another stage rewrites both sibling groups', () => {
    const result = plan({ taskId: 'roadmap', stage: 'backlog', parentTaskId: null, index: 0 });
    assert.deepEqual(order(result.tasks, 'onboarding'), ['setup']);
    assert.deepEqual(order(result.tasks, 'backlog'), ['roadmap', 'robots', 'https', 'later']);
    const byId = new Map(result.writes.map(write => [write.id, write]));
    assert.equal(byId.get('roadmap')?.stage, 'backlog');
    assert.equal(byId.get('roadmap')?.position, 1);
    assert.equal(byId.get('roadmap')?.parentTaskId, null);
    assert.equal(byId.has('setup'), false);
    assert.equal(result.tasks.find(item => item.id === 'setup')?.position, 1);
    assert.equal(byId.get('robots')?.position, 2);
    assert.equal(byId.get('robots')?.stage, 'backlog');
});

test('a pillar keeps its subtasks and they inherit the destination stage', () => {
    const result = plan({ taskId: 'setup', stage: 'backlog', parentTaskId: null, index: 0 });
    assert.deepEqual(order(result.tasks, 'backlog'), ['setup', 'robots', 'https', 'later']);
    assert.deepEqual(order(result.tasks, 'backlog', 'setup'), ['keywords', 'cookies']);
    assert.deepEqual(order(result.tasks, 'onboarding'), ['roadmap']);
    const cookies = result.tasks.find(item => item.id === 'cookies');
    const keywords = result.tasks.find(item => item.id === 'keywords');
    assert.equal(cookies?.stage, 'backlog');
    assert.equal(cookies?.parentTaskId, 'setup');
    assert.equal(cookies?.position, 2);
    assert.equal(keywords?.stage, 'backlog');
    assert.equal(keywords?.position, 1);
    assert.equal(result.tasks.find(item => item.id === 'roadmap')?.stage, 'onboarding');
    assert.equal(result.tasks.find(item => item.id === 'roadmap')?.position, 1);
});

test('subtasks reorder inside the pillar and take the pillar stage', () => {
    const result = plan({ taskId: 'cookies', stage: 'onboarding', parentTaskId: 'setup', index: 0 });
    assert.deepEqual(order(result.tasks, 'onboarding', 'setup'), ['cookies', 'keywords']);
    const cookies = result.writes.find(write => write.id === 'cookies');
    const keywords = result.writes.find(write => write.id === 'keywords');
    assert.deepEqual(cookies, { id: 'cookies', stage: 'onboarding', position: 1, parentTaskId: 'setup' });
    assert.equal(keywords?.position, 2);
    assert.equal(keywords?.stage, 'onboarding');
    assert.equal(result.writes.some(write => write.id === 'setup' || write.id === 'robots'), false);
});

test('dropping a task on a pillar nests it at the end and clears it from the stage', () => {
    const result = plan({ taskId: 'robots', stage: 'backlog', parentTaskId: 'setup', index: 5 });
    assert.equal(result.tasks.find(item => item.id === 'robots')?.parentTaskId, 'setup');
    assert.equal(result.tasks.find(item => item.id === 'robots')?.stage, 'onboarding');
    assert.deepEqual(order(result.tasks, 'onboarding', 'setup'), ['keywords', 'cookies', 'robots']);
    assert.deepEqual(order(result.tasks, 'backlog'), ['https', 'later']);
    assert.equal(result.writes.find(write => write.id === 'https')?.position, 1);
});

test('pulling a subtask onto a stage un-nests it there', () => {
    const result = plan({ taskId: 'keywords', stage: 'backlog', parentTaskId: null, index: 1 });
    assert.equal(result.tasks.find(item => item.id === 'keywords')?.parentTaskId, null);
    assert.equal(result.tasks.find(item => item.id === 'keywords')?.stage, 'backlog');
    assert.deepEqual(order(result.tasks, 'backlog'), ['robots', 'keywords', 'https', 'later']);
    assert.deepEqual(order(result.tasks, 'onboarding', 'setup'), ['cookies']);
    assert.equal(result.writes.find(write => write.id === 'cookies')?.position, 1);
    assert.equal(result.writes.find(write => write.id === 'cookies')?.parentTaskId, 'setup');
});

test('a subtask can move from one pillar to another and still sit one level down', () => {
    const withSecond = [
        ...tasks,
        task({ id: 'local', title: 'Local SEO', stage: 'backlog', position: 1 }),
        task({ id: 'gbp', title: 'Complete GBP', stage: 'backlog', position: 1, parentTaskId: 'local' }),
    ];
    const result = plan({ taskId: 'keywords', stage: 'onboarding', parentTaskId: 'local', index: 0 }, withSecond);
    assert.equal(result.tasks.find(item => item.id === 'keywords')?.parentTaskId, 'local');
    assert.equal(result.tasks.find(item => item.id === 'keywords')?.stage, 'backlog');
    assert.deepEqual(order(result.tasks, 'backlog', 'local'), ['keywords', 'gbp']);
});

test('nesting refuses a pillar, a subtask parent, a self parent, and a recurring row', () => {
    const underSubtask = applyStageReorder(tasks, { taskId: 'robots', stage: 'onboarding', parentTaskId: 'keywords', index: 0 });
    assert.deepEqual(underSubtask, { ok: false, error: STAGE_REORDER_ONE_LEVEL });

    const nestedPillar = [
        ...tasks,
        task({ id: 'local', title: 'Local SEO', stage: 'backlog', position: 1 }),
        task({ id: 'gbp', title: 'Complete GBP', stage: 'backlog', position: 1, parentTaskId: 'local' }),
    ];
    const tooDeep = applyStageReorder(nestedPillar, { taskId: 'local', stage: 'onboarding', parentTaskId: 'setup', index: 0 });
    assert.deepEqual(tooDeep, { ok: false, error: STAGE_REORDER_PILLAR });

    const self = applyStageReorder(tasks, { taskId: 'robots', stage: 'backlog', parentTaskId: 'robots', index: 0 });
    assert.deepEqual(self, { ok: false, error: STAGE_REORDER_SELF });

    const recurring = applyStageReorder(tasks, { taskId: 'later', stage: 'onboarding', parentTaskId: 'setup', index: 0 });
    assert.deepEqual(recurring, { ok: false, error: STAGE_REORDER_RECURRING });
});

test('an unknown task and a no-op write nothing', () => {
    const missing = applyStageReorder(tasks, { taskId: 'missing', stage: 'backlog', parentTaskId: null, index: 0 });
    assert.equal(missing.ok, false);
    const same = plan({ taskId: 'robots', stage: 'backlog', parentTaskId: null, index: 0 });
    assert.deepEqual(same.writes, []);
    assert.deepEqual(same.tasks, tasks);
});

test('a recurring successor stays top-level when its stage changes', () => {
    const result = plan({ taskId: 'later', stage: 'onboarding', parentTaskId: null, index: 0 });
    const later = result.tasks.find(item => item.id === 'later');
    assert.equal(later?.stage, 'onboarding');
    assert.equal(later?.parentTaskId, 'done');
    assert.equal(later?.recurring, true);
    assert.deepEqual(order(result.tasks, 'onboarding'), ['later', 'setup', 'roadmap']);
    assert.deepEqual(order(result.tasks, 'backlog'), ['robots', 'https']);
});

test('rollback restores only the moved rows and a save replaces those copies', () => {
    const result = plan({ taskId: 'roadmap', stage: 'backlog', parentTaskId: null, index: 0 });
    const added = [...result.tasks, task({ id: 'pending:new', title: 'Fresh', stage: 'backlog', position: 2 })];
    const restored = restoreStageTasks(added, tasks, result.writes.map(write => write.id));
    assert.equal(restored.find(item => item.id === 'roadmap')?.stage, 'onboarding');
    assert.equal(restored.find(item => item.id === 'pending:new')?.title, 'Fresh');
    const saved = task({ id: 'roadmap', title: 'Create SEO Roadmap', stage: 'backlog', position: 4 });
    assert.equal(mergeStageTasks(result.tasks, [saved]).find(item => item.id === 'roadmap')?.position, 4);
});

test('a move keeps a live URL the save payload does not return', () => {
    const current = [task({ id: 'piece', title: 'Chino service page', publishedUrl: 'https://example.com/chino' })];
    const saved = task({ id: 'piece', title: 'Chino service page', stage: 'backlog', position: 1 });
    assert.equal(mergeStageTasks(current, [saved])[0].publishedUrl, 'https://example.com/chino');
    const cleared = task({ id: 'piece', title: 'Chino service page', publishedUrl: null });
    assert.equal(mergeStageTasks(current, [cleared])[0].publishedUrl, null);
});

test('the middle of a pillar header nests, and its edges reorder', () => {
    const nest = describeStageDrop({
        tasks,
        dragId: 'robots',
        overTaskId: 'setup',
        overStage: null,
        overParentId: null,
        pointerFraction: 0.5,
    });
    assert.equal(nest?.hint.type, 'nest');
    assert.equal(nest?.move.parentTaskId, 'setup');
    assert.equal(nest?.move.index, 2);

    const before = describeStageDrop({
        tasks,
        dragId: 'robots',
        overTaskId: 'setup',
        overStage: null,
        overParentId: null,
        pointerFraction: 0.1,
    });
    assert.equal(before?.hint.type, 'insert');
    assert.equal(before?.move.parentTaskId, null);
    assert.equal(before?.move.stage, 'onboarding');
    assert.equal(before?.move.index, 0);

    const after = describeStageDrop({
        tasks,
        dragId: 'https',
        overTaskId: 'later',
        overStage: null,
        overParentId: null,
        pointerFraction: 0.9,
    });
    assert.equal(after?.move.parentTaskId, null);
    assert.equal(after?.move.index, 2);
});

test('a subtask grip lands among siblings, and a stage drop un-nests', () => {
    const inside = describeStageDrop({
        tasks,
        dragId: 'cookies',
        overTaskId: 'keywords',
        overStage: null,
        overParentId: null,
        pointerFraction: 0.2,
    });
    assert.equal(inside?.move.parentTaskId, 'setup');
    assert.equal(inside?.move.index, 0);

    const out = describeStageDrop({
        tasks,
        dragId: 'keywords',
        overTaskId: null,
        overStage: 'backlog',
        overParentId: null,
        pointerFraction: null,
    });
    assert.equal(out?.move.parentTaskId, null);
    assert.equal(out?.move.stage, 'backlog');
    assert.equal(out?.move.index, 3);
});

test('a pillar cannot be dropped onto a header or into subtasks', () => {
    const onHeader = describeStageDrop({
        tasks,
        dragId: 'setup',
        overTaskId: 'robots',
        overStage: null,
        overParentId: null,
        pointerFraction: 0.5,
    });
    assert.equal(onHeader?.move.parentTaskId, null);
    assert.equal(onHeader?.move.stage, 'backlog');

    const intoChildren = describeStageDrop({
        tasks,
        dragId: 'setup',
        overTaskId: 'keywords',
        overStage: null,
        overParentId: null,
        pointerFraction: 0.5,
    });
    assert.equal(intoChildren, null);
});

test('keyboard moves walk the sibling list, the stage list, and out of a pillar', () => {
    assert.equal(stageMoveBy(tasks, 'robots', 'up'), null);
    assert.deepEqual(stageMoveBy(tasks, 'https', 'up'), {
        taskId: 'https',
        stage: 'backlog',
        parentTaskId: null,
        index: 0,
    });
    assert.deepEqual(stageMoveBy(tasks, 'roadmap', 'next-stage'), {
        taskId: 'roadmap',
        stage: 'backlog',
        parentTaskId: null,
        index: 3,
    });
    assert.equal(stageMoveBy(tasks, 'roadmap', 'previous-stage'), null);
    assert.deepEqual(stageMoveBy(tasks, 'keywords', 'unnest'), {
        taskId: 'keywords',
        stage: 'onboarding',
        parentTaskId: null,
        index: 1,
    });
    assert.equal(stageMoveBy(tasks, 'setup', 'unnest'), null);
    assert.equal(stageMoveBy(tasks, 'cookies', 'next-stage'), null);
    assert.deepEqual(stageMoveBy(tasks, 'cookies', 'up'), {
        taskId: 'cookies',
        stage: 'onboarding',
        parentTaskId: 'setup',
        index: 0,
    });
});

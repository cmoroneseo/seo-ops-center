import assert from 'node:assert/strict';
import test from 'node:test';

import { compareStageListTasks, type StageListTask } from './stage-list.ts';
import {
    alignBasecampStepOrder,
    basecampStepOrderMoves,
    compareAppSubtaskOrder,
    linkedStepIds,
    sortByAppOrder,
    type AppSubtaskOrder,
    type StepOrderMove,
} from './basecamp-step-order.ts';

function asStage(row: AppSubtaskOrder): StageListTask {
    return {
        id: row.id,
        title: row.id,
        status: 'todo',
        stage: 'onboarding',
        position: row.position ?? null,
        parentTaskId: null,
        createdAt: row.createdAt ?? null,
        category: null,
        basecamp: false,
        recurring: false,
    };
}

/** Apply 1-based moves the way Basecamp's position endpoint shifts siblings. */
function applyMoves(current: readonly string[], moves: readonly StepOrderMove[]): string[] {
    const list = [...current];
    for (const move of moves) {
        const from = list.indexOf(move.stepId);
        if (from >= 0) list.splice(from, 1);
        list.splice(move.position - 1, 0, move.stepId);
    }
    return list;
}

const floorCo = [
    { id: 'list', title: 'List duplicate and junk pages', position: 1, createdAt: '2026-10-01T00:00:00.000Z', basecampTodoId: '11' },
    { id: 'pick', title: 'Pick the main page', position: 2, createdAt: '2026-10-02T00:00:00.000Z', basecampTodoId: '22' },
    { id: 'carlos', title: "Get Carlos's approval", position: 3, createdAt: '2026-10-03T00:00:00.000Z', basecampTodoId: '33' },
    { id: 'clean', title: 'Clean the sitemap', position: 4, createdAt: '2026-10-04T00:00:00.000Z', basecampTodoId: '44' },
    { id: 'index', title: 'Request indexing', position: 5, createdAt: '2026-10-05T00:00:00.000Z', basecampTodoId: '55' },
];

test('plan order is position, then created_at, then id, matching the stage list', () => {
    const rows = [
        { id: 'b', position: 1, createdAt: '2026-02-01T00:00:00.000Z' },
        { id: 'd', position: 1, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'a', position: 1, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'c', position: null, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'e', position: 2, createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    const ordered = sortByAppOrder(rows);
    assert.deepEqual(ordered.map(row => row.id), ['a', 'd', 'b', 'e', 'c']);
    const stageOrdered = [...rows].sort((left, right) => compareStageListTasks(asStage(left), asStage(right)));
    assert.deepEqual(ordered.map(row => row.id), stageOrdered.map(row => row.id));
    assert.equal(compareAppSubtaskOrder(rows[1], rows[2]), compareStageListTasks(asStage(rows[1]), asStage(rows[2])));
});

test('Floor Co steps that Basecamp stored with Clean first are moved into plan order', () => {
    const shuffled = [floorCo[3], floorCo[4], floorCo[0], floorCo[2], floorCo[1]];
    const desired = linkedStepIds(shuffled);
    assert.deepEqual(desired, ['11', '22', '33', '44', '55']);
    const current = ['44', '55', '11', '33', '22'];
    const moves = basecampStepOrderMoves(current, desired);
    assert.deepEqual(applyMoves(current, moves).slice(0, desired.length), desired);
    assert.deepEqual(basecampStepOrderMoves(desired, desired), []);
});

test('a checklist that already follows the plan is left alone, even with an extra step', () => {
    assert.deepEqual(basecampStepOrderMoves(['99', '11', '22', '33'], ['11', '22', '33']), []);
    assert.deepEqual(basecampStepOrderMoves(['11', '99', '22'], ['11', '22']), []);
    assert.deepEqual(basecampStepOrderMoves([], []), []);
    assert.deepEqual(basecampStepOrderMoves(['11'], []), []);
});

test('align lists once and repositions only the steps that are out of place', async () => {
    const listed: string[] = [];
    const moved: string[] = [];
    const matched = await alignBasecampStepOrder({
        projectId: '48599958',
        parentTodoId: '10429396134',
        desiredStepIds: ['11', '22'],
        listSteps: async () => {
            listed.push('list');
            return { ok: true, steps: [{ id: '11' }, { id: '22' }] };
        },
        repositionStep: async move => {
            moved.push(`${move.stepId}:${move.position}`);
            return { ok: true };
        },
    });
    assert.deepEqual(matched, { ok: true, moves: [] });
    assert.deepEqual(moved, []);

    const fixed = await alignBasecampStepOrder({
        projectId: '48599958',
        parentTodoId: '10429396134',
        desiredStepIds: ['11', '22', '44'],
        listSteps: async () => ({ ok: true, steps: [{ id: '44' }, { id: '11' }, { id: '22' }] }),
        repositionStep: async move => {
            moved.push(`${move.stepId}:${move.position}`);
            return { ok: true };
        },
    });
    assert.equal(fixed.ok, true);
    if (fixed.ok) assert.deepEqual(applyMoves(['44', '11', '22'], fixed.moves).slice(0, 3), ['11', '22', '44']);
    assert.deepEqual(listed, ['list']);
});

test('a failed reposition stops the pass and an empty plan does not read Basecamp', async () => {
    let lists = 0;
    let moves = 0;
    const empty = await alignBasecampStepOrder({
        projectId: '48599958',
        parentTodoId: '10429396134',
        desiredStepIds: [],
        listSteps: async () => {
            lists += 1;
            return { ok: true, steps: [] };
        },
        repositionStep: async () => {
            moves += 1;
            return { ok: true };
        },
    });
    assert.deepEqual(empty, { ok: true, moves: [] });
    assert.equal(lists, 0);

    const failed = await alignBasecampStepOrder({
        projectId: '48599958',
        parentTodoId: '10429396134',
        desiredStepIds: ['11', '22'],
        listSteps: async () => ({ ok: true, steps: [{ id: '22' }, { id: '11' }] }),
        repositionStep: async () => ({ ok: false, status: 422, message: 'Basecamp returned 422.', scope: 'task' }),
    });
    assert.deepEqual(failed, { ok: false, status: 422, message: 'Basecamp returned 422.', scope: 'task' });
    assert.equal(moves, 0);
});

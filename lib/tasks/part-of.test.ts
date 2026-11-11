import assert from 'node:assert/strict';
import test from 'node:test';

import { projectClientRoadmap } from '../reports/roadmap.ts';
import {
    PART_OF_MAIN_TASK_ERROR,
    PART_OF_OTHER_CLIENT_ERROR,
    PART_OF_TERM,
    linkedTaskProgress,
    partOfLine,
    partOfWrite,
    tasksPartOf,
    type PartOfTask,
} from './part-of.ts';

const org = '11111111-1111-4111-8111-111111111111';
const client = '33333333-3333-4333-8333-333333333333';
const otherClient = '44444444-4444-4444-8444-444444444444';
const rank = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const owned = { parentTaskId: null, clientId: client, organizationId: org };
const goal = { id: rank, clientId: client, organizationId: org };

function task(partial: Partial<PartOfTask> & Pick<PartOfTask, 'id' | 'title'>): PartOfTask {
    return {
        status: 'todo',
        parentTaskId: null,
        initiativeId: null,
        ...partial,
    };
}

test('linking, unlinking, and a different client are decided before the write', () => {
    assert.equal(PART_OF_TERM, 'Part of');
    assert.equal(partOfLine('Rank the service pages', true), 'Part of: Rank the service pages');
    assert.equal(partOfLine(null, false), 'Part of: None');
    assert.deepEqual(partOfWrite(owned, goal, rank), { ok: true, initiativeId: rank });
    assert.deepEqual(partOfWrite(owned, goal, null), { ok: true, initiativeId: null });
    assert.deepEqual(partOfWrite({ ...owned, parentTaskId: 'parent' }, goal, rank), {
        ok: false,
        error: PART_OF_MAIN_TASK_ERROR,
    });
    const cross = partOfWrite(owned, { ...goal, clientId: otherClient }, rank);
    assert.equal(cross.ok, false);
    if (!cross.ok) assert.equal(cross.error, PART_OF_OTHER_CLIENT_ERROR);
    const missing = partOfWrite(owned, null, other);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error, PART_OF_OTHER_CLIENT_ERROR);
    assert.equal(partOfWrite({ ...owned, clientId: null }, goal, rank).ok, false);
});

test('progress counts top-level tasks and says nothing when none are linked', () => {
    const tasks = [
        task({ id: 'page', title: 'Rewrite the service page', initiativeId: rank }),
        task({ id: 'proof', title: 'Publish the proof', status: 'done', initiativeId: rank }),
        task({ id: 'heading', title: 'Check one heading', status: 'done', parentTaskId: 'page', initiativeId: rank }),
        task({ id: 'other', title: 'Fix the footer', status: 'done', initiativeId: other }),
    ];
    const progress = linkedTaskProgress(rank, tasks);
    assert.ok(progress);
    assert.equal(progress.done, 1);
    assert.equal(progress.total, 2);
    assert.equal(progress.label, '1 of 2 tasks done');
    assert.deepEqual(progress.tasks.map(row => row.id), ['page', 'proof']);
    assert.equal(linkedTaskProgress(rank, tasks.filter(row => row.id === 'heading')), null);
    assert.equal(linkedTaskProgress('cccccccc-cccc-4ccc-8ccc-cccccccccccc', tasks), null);

    const visible = tasksPartOf(tasks, rank);
    assert.deepEqual(visible.map(row => row.id), ['page', 'proof', 'heading']);
    assert.equal(tasksPartOf(tasks, null).length, tasks.length);
});

test('the client roadmap does not gain a public link field', () => {
    const roadmap = projectClientRoadmap({
        board: 'phases',
        today: '2026-11-07',
        tasks: [{
            id: 'page',
            title: 'Rewrite the service page',
            status: 'todo',
            stage: 'foundation',
            position: 1,
            parentTaskId: null,
            createdAt: null,
            category: null,
            basecamp: false,
            recurring: false,
            initiativeId: rank,
        }],
    });
    const json = JSON.stringify(roadmap);
    assert.match(json, /Rewrite the service page/);
    assert.equal(json.includes(rank), false);
    assert.equal(json.includes('initiative'), false);
    assert.equal(json.includes('Part of'), false);
});

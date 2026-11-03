import assert from 'node:assert/strict';
import test from 'node:test';

import { PLAN_LABELS } from '../seo-plan/plan-panel.ts';
import { taskCreateRow } from '../tasks/create-row.ts';
import {
    BUILT_IN_TASK_CATEGORIES,
    botCreatedTaskRow,
    isBuiltInTaskCategory,
    taskCategoryAllowed,
    taskCategoryShapeError,
} from './task-create.ts';

const ACTOR = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-11-03T18:00:00.000Z';

test('built-in categories are the plan labels plus Reporting from the create window', () => {
    assert.deepEqual(
        [...BUILT_IN_TASK_CATEGORIES],
        [...PLAN_LABELS.map(label => label.id), 'reporting'],
    );
    assert.equal(isBuiltInTaskCategory('technical'), true);
    assert.equal(isBuiltInTaskCategory('Technical'), false);
    assert.equal(isBuiltInTaskCategory('SEO'), false);
    assert.equal(taskCategoryAllowed('technical', []), true);
    assert.equal(taskCategoryAllowed('SEO', ['SEO', 'Set up SEO campaign']), true);
    assert.equal(taskCategoryAllowed('seo', ['SEO']), false);
    assert.equal(taskCategoryAllowed('Brand new group', ['SEO']), false);
    assert.equal(taskCategoryShapeError('Set up SEO campaign'), null);
    assert.match(taskCategoryShapeError('S'.repeat(81)) ?? '', /80 characters/);
});

test('a bot task is the create-window row, assigned to the actor in both assignee columns', () => {
    const row = botCreatedTaskRow({
        organizationId: 'org',
        clientId: 'client',
        title: 'Kentina tracking fixes',
        category: 'technical',
        dueDate: '2026-11-04',
        actorUserId: ACTOR,
        botKeyId: 'key',
        botOperationId: 'operation',
        now: NOW,
    });
    const created = taskCreateRow({
        organizationId: 'org',
        clientId: 'client',
        title: 'Kentina tracking fixes',
        category: 'technical',
        dueDate: '2026-11-04',
        assigneeIds: [ACTOR],
        createdBy: ACTOR,
        status: 'todo',
        priority: 'medium',
    });
    for (const [key, value] of Object.entries(created)) {
        if (value === undefined) {
            assert.equal(Object.hasOwn(row, key), false, key);
            continue;
        }
        assert.deepEqual(row[key], value, key);
    }
    assert.equal(row.assignee_id, ACTOR);
    assert.deepEqual(row.assignee_ids, [ACTOR]);
    assert.equal(row.created_by, ACTOR);
    assert.deepEqual(row.tags, []);
    assert.deepEqual(row.watcher_ids, []);
    assert.equal(row.category, 'technical');
    assert.equal(row.priority, 'medium');
    assert.equal(row.status, 'todo');
    assert.deepEqual(row.status_history, [{ status: 'todo', at: NOW, by: ACTOR }]);
    assert.equal(row.bot_key_id, 'key');
    assert.equal(row.bot_operation_id, 'operation');
    assert.equal(Object.hasOwn(row, 'stage'), false);
    assert.equal(Object.hasOwn(row, 'position'), false);
});

test('an omitted category is left off the row, the same way a new task starts', () => {
    const row = botCreatedTaskRow({
        organizationId: 'org',
        clientId: 'client',
        title: 'Write the brief',
        actorUserId: ACTOR,
        botKeyId: 'key',
        botOperationId: 'operation',
        now: NOW,
    });
    assert.equal(Object.hasOwn(row, 'category'), false);
    assert.equal(Object.hasOwn(row, 'due_date'), false);
    assert.deepEqual(row.tags, []);
    assert.equal(row.assignee_id, ACTOR);
    assert.deepEqual(row.assignee_ids, [ACTOR]);
});

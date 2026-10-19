import assert from 'node:assert/strict';
import test from 'node:test';

import { taskCreateRow } from './create-row.ts';

test('a normal create omits stage and position so the database defaults stay in place', () => {
    const row = taskCreateRow({
        organizationId: 'org',
        clientId: 'client',
        title: 'Review robots.txt',
        createdBy: 'user-1',
    });
    assert.equal(Object.hasOwn(row, 'stage'), false);
    assert.equal(Object.hasOwn(row, 'position'), false);
    assert.equal(row.organization_id, 'org');
    assert.equal(row.client_id, 'client');
    assert.equal(row.title, 'Review robots.txt');
    assert.equal(row.status, 'todo');
    assert.equal(row.priority, 'medium');
    assert.equal(row.created_by, 'user-1');
    assert.deepEqual(row.assignee_ids, []);
    assert.equal(Object.hasOwn(row, 'basecamp_todo_id'), false);
    assert.equal(Object.hasOwn(row, 'basecamp_project_id'), false);
    assert.equal(Object.hasOwn(row, 'published_url'), false);
});

test('stage and position are written only when the caller sets them', () => {
    const row = taskCreateRow({
        organizationId: 'org',
        clientId: 'client',
        title: 'Review robots.txt',
        stage: 'backlog',
        position: 4,
        parentTaskId: 'pillar',
        sortOrder: 2,
        createdBy: 'user-1',
    });
    assert.equal(row.stage, 'backlog');
    assert.equal(row.position, 4);
    assert.equal(row.parent_task_id, 'pillar');
    assert.equal(row.sort_order, 2);
    assert.equal(taskCreateRow({ title: 'Chino page', publishedUrl: 'https://example.com/chino' }).published_url, 'https://example.com/chino');
    assert.equal(Object.hasOwn(taskCreateRow({ position: Number.NaN }), 'position'), false);
    assert.equal(Object.hasOwn(taskCreateRow({ stage: 'month_1' as 'backlog' }), 'stage'), false);
});

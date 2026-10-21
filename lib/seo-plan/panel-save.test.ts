import assert from 'node:assert/strict';
import test from 'node:test';

import {
    beginPanelSave,
    emptyPanelSaveLedger,
    finishPanelSave,
    mergeDetailField,
    mergeListField,
    mergeRefreshedTasks,
    panelSaveIsCurrent,
    restoreListField,
} from './panel-save.ts';
import type { StageListTask } from './stage-list.ts';
import type { Task } from '../types.ts';

function row(overrides: Partial<StageListTask> = {}): StageListTask {
    return {
        id: 'r30',
        title: 'R30',
        status: 'in_progress',
        stage: 'backlog',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-10-21T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        description: '',
        estimatedHours: null,
        ...overrides,
    };
}

function saved(overrides: Partial<Task>): Task {
    return {
        id: 'r30',
        title: 'R30',
        status: 'in_progress',
        organizationId: 'org',
        priority: 'medium',
        assigneeIds: [],
        subtasks: [],
        sortOrder: 0,
        statusHistory: [],
        customFields: {},
        watcherIds: [],
        tags: [],
        updatedAt: '2026-10-21T19:00:00.000Z',
        ...overrides,
    } as Task;
}

test('a slow description response cannot drop a newer estimate or status', () => {
    let ledger = emptyPanelSaveLedger();
    const description = beginPanelSave(ledger, 'r30', 'description');
    ledger = description.ledger;
    const estimate = beginPanelSave(ledger, 'r30', 'estimate');
    ledger = estimate.ledger;
    const status = beginPanelSave(ledger, 'r30', 'status');
    ledger = status.ledger;

    let list = row();
    let detail = saved({ description: '', estimatedHours: null, status: 'in_progress' });

    list = mergeListField(list, saved({ status: 'done', completedAt: '2026-10-21T19:01:00.000Z', blockedReason: null, updatedAt: '2026-10-21T19:01:00.000Z' }), 'status');
    detail = mergeDetailField(detail, saved({ status: 'done', completedAt: '2026-10-21T19:01:00.000Z', blockedReason: null, updatedAt: '2026-10-21T19:01:00.000Z' }), 'status');
    list = mergeListField(list, saved({ estimatedHours: 2, description: '', updatedAt: '2026-10-21T19:02:00.000Z' }), 'estimate');
    detail = mergeDetailField(detail, saved({ estimatedHours: 2, description: '', updatedAt: '2026-10-21T19:02:00.000Z' }), 'estimate');

    const staleDescription = saved({
        description: 'Publish the November pages and record the baseline.',
        estimatedHours: null,
        status: 'in_progress',
        updatedAt: '2026-10-21T19:00:30.000Z',
    });
    assert.equal(panelSaveIsCurrent(ledger, 'r30', 'description', description.ticket), true);
    list = mergeListField(list, staleDescription, 'description');
    detail = mergeDetailField(detail, staleDescription, 'description');

    assert.equal(list.status, 'done');
    assert.equal(list.estimatedHours, 2);
    assert.equal(list.description, 'Publish the November pages and record the baseline.');
    assert.equal(detail.status, 'done');
    assert.equal(detail.estimatedHours, 2);
    assert.equal(detail.description, 'Publish the November pages and record the baseline.');
});

test('an older description response is ignored once a later description save exists', () => {
    let ledger = emptyPanelSaveLedger();
    const first = beginPanelSave(ledger, 'r30', 'description');
    ledger = first.ledger;
    const second = beginPanelSave(ledger, 'r30', 'description');
    ledger = second.ledger;
    assert.equal(panelSaveIsCurrent(ledger, 'r30', 'description', first.ticket), false);
    assert.equal(panelSaveIsCurrent(ledger, 'r30', 'description', second.ticket), true);

    const list = row({ description: 'Second draft' });
    const applied = panelSaveIsCurrent(ledger, 'r30', 'description', second.ticket)
        ? mergeListField(list, saved({ description: 'Second draft' }), 'description')
        : list;
    const ignored = panelSaveIsCurrent(ledger, 'r30', 'description', first.ticket)
        ? mergeListField(applied, saved({ description: '' }), 'description')
        : applied;
    assert.equal(ignored.description, 'Second draft');
});

test('a failed status save restores only status', () => {
    const snapshot = row({ status: 'in_progress', description: '' });
    const current = row({ status: 'done', completedAt: '2026-10-21T19:00:00.000Z', description: 'Kept', estimatedHours: 1.5 });
    const restored = restoreListField(current, snapshot, 'status');
    assert.equal(restored.status, 'in_progress');
    assert.equal(restored.description, 'Kept');
    assert.equal(restored.estimatedHours, 1.5);
});

test('a list reload keeps a row that still has a save in flight', () => {
    let ledger = emptyPanelSaveLedger();
    ledger = beginPanelSave(ledger, 'r30', 'status').ledger;
    const local = [
        row({ status: 'done', completedAt: '2026-10-21T19:00:00.000Z', description: 'Notes', estimatedHours: 2 }),
        row({ id: 'pending:new', title: 'Next', status: 'todo' }),
    ];
    const fresh = [row({ status: 'in_progress', description: '', estimatedHours: null })];
    const merged = mergeRefreshedTasks(local, fresh, new Set(['r30']));
    assert.equal(merged.find(task => task.id === 'r30')?.status, 'done');
    assert.equal(merged.find(task => task.id === 'r30')?.description, 'Notes');
    assert.equal(merged.find(task => task.id === 'r30')?.estimatedHours, 2);
    assert.equal(merged.some(task => task.id === 'pending:new'), true);
    ledger = finishPanelSave(ledger, 'r30');
    const settled = mergeRefreshedTasks(local, fresh, new Set(ledger.openByTask ? Object.keys(ledger.openByTask) : []));
    assert.equal(settled.find(task => task.id === 'r30')?.status, 'in_progress');
});

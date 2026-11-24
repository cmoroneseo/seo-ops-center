import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initiativeRow, normalizeInitiativeDraft } from '../campaign-workspace/initiatives';
import { buildProjectDraft, filterProjectTasks, PROJECT_STATUS, projectProgress } from './project-cards';

const tasks = [
    { id: 'done', initiativeId: 'project', status: 'done', dueDate: '2026-01-01' },
    { id: 'open', initiativeId: 'project', status: 'todo', dueDate: '2026-02-01' },
    { id: 'later', initiativeId: 'project', status: 'in_progress', dueDate: '2026-03-01' },
    { id: 'undated', initiativeId: 'project', status: 'todo' },
    { id: 'child', parentTaskId: 'open', status: 'done', dueDate: '2026-01-02' },
    { id: 'grandchild', parentTaskId: 'child', status: 'todo' },
    { id: 'other', initiativeId: 'other', status: 'done', dueDate: '2026-01-04' },
    { id: 'other-child', parentTaskId: 'other', initiativeId: 'project', status: 'todo' },
];

test('project progress counts only linked top-level tasks with done status', () => {
    const { done, total } = projectProgress('project', tasks);
    assert.deepEqual({ done, total }, { done: 1, total: 4 });
});

test('project next due date comes from the earliest dated open task', () => {
    assert.equal(projectProgress('project', tasks).nextDue, '2026-02-01');
    assert.equal(projectProgress('other', tasks).nextDue, null);
});

test('project page includes children through their parent', () => {
    assert.deepEqual(filterProjectTasks('project', tasks).map(task => task.id), [
        'done', 'open', 'later', 'undated', 'child', 'grandchild',
    ]);
});

test('project status labels are plain English for all six states', () => {
    assert.deepEqual(Object.fromEntries(Object.entries(PROJECT_STATUS).map(([state, status]) => [state, status.label])), {
        planned: 'Planned',
        in_progress: 'In progress',
        awaiting_approval: 'Waiting on approval',
        blocked: 'Blocked',
        on_hold: 'On hold',
        completed_verified: 'Completed and verified',
    });
});

test('project draft takes a trimmed name and category and saves without dates or phase', () => {
    const draft = buildProjectDraft('  Site fixes  ', 'technical');
    const result = normalizeInitiativeDraft(draft);
    assert.ok(result.ok);
    assert.equal(result.value.title, 'Site fixes');
    assert.equal(result.value.category, 'technical');
    assert.equal(result.value.state, 'planned');
    assert.equal(result.value.phase, null);
    assert.equal(result.value.startsOn, null);
    assert.equal(result.value.endsOn, null);
});

test('project draft rejects a blank name or unknown category', () => {
    assert.throws(() => buildProjectDraft('   ', 'technical'), /name/i);
    assert.throws(() => buildProjectDraft('Site fixes', 'unknown'), /category/i);
});

test('a new project row is scoped to the client and organization and starts as Planned', () => {
    const result = normalizeInitiativeDraft(buildProjectDraft('GBP Optimization', 'local_seo'));
    assert.ok(result.ok);
    const row = initiativeRow({ organizationId: 'org-1', clientId: 'client-1' }, result.value);
    assert.equal(row.organization_id, 'org-1');
    assert.equal(row.client_id, 'client-1');
    assert.equal(row.title, 'GBP Optimization');
    assert.equal(row.category, 'local_seo');
    assert.equal(row.state, 'planned');
    assert.equal(row.phase, null);
});

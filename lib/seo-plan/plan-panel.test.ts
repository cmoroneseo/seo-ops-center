import test from 'node:test';
import assert from 'node:assert/strict';

import type { StageListTask } from './stage-list.ts';
import { applyStageReorder } from './stage-reorder.ts';
import {
    PLAN_BLOCKED_LABEL_FOLLOW_UP,
    PLAN_LABELS,
    PLAN_PANEL_STATUSES,
    PLAN_PANEL_STATUS_LABEL,
    basecampTodoHref,
    commitPlanTextSave,
    completionForPlanStatus,
    displayPlanStatus,
    formatPlanCreated,
    formatSyncedAgo,
    groupPlanTimeByMonth,
    mergePlanTask,
    parsePlanEstimate,
    planBasecampLine,
    planDeleteCopy,
    planDescriptionSave,
    planDuplicateTitle,
    planLiveUrlSave,
    planOnboardingStage,
    planPanelDue,
    planPanelKeyAction,
    planPanelTask,
    planParentField,
    planParentMove,
    planTasksWithout,
    planTitleSave,
    queuePlanTextSave,
    readPlanLabels,
    togglePlanValue,
    writePlanLabels,
} from './plan-panel.ts';
import type { Task } from '../types.ts';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'backlog',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-10-02T15:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

const kitchen = task({
    id: 'kitchen',
    title: 'Service page refresh: Kitchen remodeling',
    stage: 'backlog',
    dueDate: '2026-10-17',
    assigneeIds: ['miguel'],
    category: 'content',
    position: 1,
});
const citations = task({
    id: 'citations',
    title: 'Citations cleanup',
    stage: 'backlog',
    position: 2,
    parentTaskId: null,
});
const houzz = task({
    id: 'houzz',
    title: 'Houzz photos',
    stage: 'backlog',
    position: 1,
    parentTaskId: 'citations',
});
const yelp = task({
    id: 'yelp',
    title: 'Yelp profile',
    stage: 'backlog',
    position: 2,
    parentTaskId: 'citations',
});
const setup = task({ id: 'setup', title: 'SEO Setup', stage: 'onboarding', position: 1 });

test('status offers To do, In progress, and Done, and maps legacy values', () => {
    assert.deepEqual(PLAN_PANEL_STATUSES.map(status => PLAN_PANEL_STATUS_LABEL[status]), [
        'To do',
        'In progress',
        'Done',
    ]);
    assert.equal(displayPlanStatus('todo'), 'todo');
    assert.equal(displayPlanStatus('in_progress'), 'in_progress');
    assert.equal(displayPlanStatus('review'), 'in_progress');
    assert.equal(displayPlanStatus('done'), 'done');
    assert.equal(displayPlanStatus('approved'), 'done');
    assert.equal(displayPlanStatus('blocked'), 'todo');
    assert.equal(PLAN_BLOCKED_LABEL_FOLLOW_UP, 'tasks.blocked_reason');
    assert.equal(PLAN_LABELS.some(label => label.id === 'blocked'), false);
});

test('Done keeps an existing completion time and any other status clears it', () => {
    assert.equal(completionForPlanStatus('done', { status: 'approved', completedAt: '2026-10-16T00:00:00.000Z' }, '2026-10-20T00:00:00.000Z'), '2026-10-16T00:00:00.000Z');
    assert.equal(completionForPlanStatus('done', { status: 'todo', completedAt: null }, '2026-10-20T00:00:00.000Z'), '2026-10-20T00:00:00.000Z');
    assert.equal(completionForPlanStatus('todo', { status: 'done', completedAt: '2026-10-16T00:00:00.000Z' }, '2026-10-20T00:00:00.000Z'), null);
    assert.equal(completionForPlanStatus('in_progress', { status: 'review', completedAt: null }, 'now'), null);
});

test('text autosave waits, then saves a changed title once', () => {
    const start = { draft: 'Kitchen', saved: 'Kitchen', dirty: false, dueAt: null };
    const typed = queuePlanTextSave(start, 'Kitchen remodel', 1_000, 500, planTitleSave);
    assert.equal(typed.dueAt, 1_500);
    assert.equal(commitPlanTextSave(typed, 1_499, planTitleSave).value, null);
    const committed = commitPlanTextSave(typed, 1_500, planTitleSave);
    assert.equal(committed.value, 'Kitchen remodel');
    assert.equal(committed.state.dirty, false);
    assert.equal(commitPlanTextSave(committed.state, 2_000, planTitleSave).value, null);

    const cleared = queuePlanTextSave(committed.state, '   ', 3_000, 500, planTitleSave);
    assert.equal(cleared.dueAt, null);
    assert.equal(planTitleSave('  Kitchen remodel  ', 'Kitchen remodel'), null);
    assert.equal(planDescriptionSave('Notes', 'Notes'), null);
    assert.equal(planDescriptionSave('Notes\n', 'Notes'), null);
    assert.equal(planDescriptionSave('', 'Notes'), '');
});

test('labels are multi-select and keep tags that are not plan labels', () => {
    assert.deepEqual(readPlanLabels('content', ['local', 'client-note', 'content']), ['content', 'local']);
    assert.deepEqual(readPlanLabels('reporting', ['strategy']), ['reporting', 'strategy']);
    const written = writePlanLabels(['local', 'links'], ['client-note', 'content', 'local']);
    assert.equal(written.category, 'local');
    assert.deepEqual(written.tags, ['local', 'links', 'client-note']);
    assert.deepEqual(togglePlanValue(['content'], 'content'), []);
    assert.deepEqual(togglePlanValue(['content'], 'admin'), ['content', 'admin']);
    assert.deepEqual(writePlanLabels([], ['client-note']).tags, ['client-note']);
    assert.equal(writePlanLabels([], ['client-note']).category, null);
});

test('estimate, live URL, and onboarding parse without a new column', () => {
    assert.deepEqual(parsePlanEstimate('2'), { ok: true, hours: 2 });
    assert.deepEqual(parsePlanEstimate('90m'), { ok: true, hours: 1.5 });
    assert.deepEqual(parsePlanEstimate(''), { ok: true, hours: null });
    assert.equal(parsePlanEstimate('soon').ok, false);
    assert.deepEqual(planLiveUrlSave('mayasconstruction.com/bathroom'), {
        ok: true,
        publishedUrl: 'https://mayasconstruction.com/bathroom',
    });
    assert.deepEqual(planLiveUrlSave(''), { ok: true, publishedUrl: null });
    assert.equal(planLiveUrlSave('not a url').ok, false);
    assert.equal(planOnboardingStage(true), 'onboarding');
    assert.equal(planOnboardingStage(false), 'backlog');
});

test('the parent picker is one level, and a pillar cannot move under another task', () => {
    const tasks = [kitchen, citations, houzz, yelp, setup];
    const pillar = planParentField(tasks, 'citations');
    assert.equal(pillar.kind, 'pillar');
    if (pillar.kind === 'pillar') assert.equal(pillar.childCount, 2);
    assert.equal(planParentMove(tasks, 'citations', 'kitchen').ok, false);

    const leaf = planParentField(tasks, 'houzz');
    assert.equal(leaf.kind, 'picker');
    if (leaf.kind === 'picker') {
        assert.deepEqual(leaf.choices.map(choice => choice.id), ['kitchen', 'citations', 'setup']);
        assert.equal(leaf.choices.some(choice => choice.id === 'yelp' || choice.id === 'houzz'), false);
        assert.equal(leaf.currentId, 'citations');
    }

    const under = planParentMove(tasks, 'kitchen', 'citations');
    assert.equal(under.ok, true);
    if (!under.ok || !under.move) return;
    assert.equal(under.move.parentTaskId, 'citations');
    assert.equal(under.move.stage, 'backlog');
    const applied = applyStageReorder(tasks, under.move);
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    assert.equal(applied.tasks.find(item => item.id === 'kitchen')?.parentTaskId, 'citations');
    assert.equal(planParentMove(tasks, 'houzz', 'yelp').ok, false);

    const unnest = planParentMove(tasks, 'houzz', null);
    assert.equal(unnest.ok, true);
    if (!unnest.ok || !unnest.move) return;
    assert.equal(unnest.move.parentTaskId, null);
    assert.equal(unnest.move.stage, 'backlog');
    assert.equal(planParentMove(tasks, 'kitchen', null).move, null);
});

test('duplicate, delete, time, and Basecamp stay on data the task already has', () => {
    assert.equal(planDuplicateTitle('Citations cleanup'), 'Citations cleanup copy');
    const removed = planTasksWithout([citations, houzz, yelp, kitchen], 'citations');
    assert.deepEqual(removed.map(item => item.id), ['kitchen']);
    assert.equal(planDeleteCopy(2), 'Delete this pillar and its 2 subtasks?');

    const months = groupPlanTimeByMonth([
        { date: '2026-10-14', hours: 0.5 },
        { date: '2026-09-02', hours: 1 },
        { date: '2026-10-02', hours: 0.25 },
        { date: '2026-10-03', hours: 0 },
    ]);
    assert.deepEqual(months.map(month => month.month), ['2026-10', '2026-09']);
    assert.equal(months[0]?.hours, 0.75);
    assert.equal(months[0]?.label, 'October 2026');

    const now = new Date('2026-10-20T18:00:00.000Z');
    const line = planBasecampLine({
        linked: true,
        href: basecampTodoHref('5338018', 48599958, 10228422582),
        listName: 'SEO: October',
        lastSyncedAt: '2026-10-20T17:58:00.000Z',
        now,
    });
    assert.equal(line.label, 'To-do in “SEO: October”');
    assert.equal(line.href, 'https://3.basecamp.com/5338018/buckets/48599958/todos/10228422582');
    assert.equal(line.synced, 'synced 2m ago');
    assert.equal(planBasecampLine({ linked: false, now }).label, 'Not in Basecamp');
    assert.equal(basecampTodoHref('', 1, 2), null);
    assert.equal(formatSyncedAgo('2026-10-20T17:59:30.000Z', now), 'synced just now');
    assert.equal(formatPlanCreated('2026-10-02T15:00:00.000Z', 'CM'), 'Created Oct 2 by CM');
    const due = planPanelDue({ dueDate: '2026-10-17', status: 'todo', completedAt: null }, '2026-10-20');
    assert.equal(due.late, true);
    assert.match(due.text, /Oct 17/);
});

test('the panel model reads the list row and fills detail without dropping assignees', () => {
    const model = planPanelTask({
        task: { ...kitchen, basecamp: true },
        tasks: [kitchen, citations, houzz],
        people: [{ id: 'carlos', name: 'Carlos Morones', initials: 'CM' }],
        accountId: '5338018',
        loggedHours: 0.5,
        logs: [{ taskId: 'kitchen', date: '2026-10-14', hours: 0.5 }],
        detail: {
            id: 'kitchen',
            description: 'Rewrite the above-the-fold copy.',
            estimatedHours: 2,
            tags: ['local'],
            createdBy: 'carlos',
            basecampTodoId: 77,
            basecampProjectId: 202,
            lastSyncedAt: '2026-10-20T17:58:00.000Z',
        } as Task,
    });
    assert.equal(model.detailsReady, true);
    assert.equal(model.description, 'Rewrite the above-the-fold copy.');
    assert.deepEqual(model.assigneeIds, ['miguel']);
    assert.deepEqual(readPlanLabels(model.category, model.tags), ['content', 'local']);
    assert.equal(model.createdByLabel, 'CM');
    assert.equal(model.basecampHref, 'https://3.basecamp.com/5338018/buckets/202/todos/77');
    assert.equal(model.timeByMonth[0]?.hours, 0.5);
    assert.equal(model.stage, 'backlog');

    const waiting = planPanelTask({ task: kitchen, tasks: [kitchen], detail: null });
    assert.equal(waiting.detailsReady, false);
    assert.equal(waiting.description, '');
    assert.equal(waiting.basecampLinked, false);
});

test('a saved task row keeps the list fields the panel writes', () => {
    const merged = mergePlanTask(kitchen, {
        ...({} as Task),
        id: 'kitchen',
        title: 'Kitchen page',
        status: 'in_progress',
        stage: 'onboarding',
        parentTaskId: undefined,
        category: 'technical',
        publishedUrl: 'https://mayasconstruction.com/kitchen',
        dueDate: '2026-10-31',
        completedAt: undefined,
        assigneeIds: ['miguel', 'carlos'],
    });
    assert.equal(merged.title, 'Kitchen page');
    assert.equal(merged.stage, 'onboarding');
    assert.equal(merged.parentTaskId, null);
    assert.deepEqual(merged.assigneeIds, ['miguel', 'carlos']);
    assert.equal(merged.completedAt, null);
    assert.equal(merged.publishedUrl, 'https://mayasconstruction.com/kitchen');
});

test('j and k move the visible row, and the open panel follows', () => {
    const ids = ['setup', 'kitchen', 'citations'];
    assert.deepEqual(planPanelKeyAction({ key: 'j', blocked: false, panelOpen: false, focusedId: null, visibleIds: ids }), {
        type: 'move',
        taskId: 'setup',
        panel: false,
    });
    assert.deepEqual(planPanelKeyAction({ key: 'k', blocked: false, panelOpen: true, focusedId: null, visibleIds: ids }), {
        type: 'move',
        taskId: 'citations',
        panel: true,
    });
    assert.deepEqual(planPanelKeyAction({ key: 'j', blocked: false, panelOpen: true, focusedId: 'kitchen', visibleIds: ids }), {
        type: 'move',
        taskId: 'citations',
        panel: true,
    });
    assert.deepEqual(planPanelKeyAction({ key: 'k', blocked: false, panelOpen: true, focusedId: 'kitchen', visibleIds: ids }), {
        type: 'move',
        taskId: 'setup',
        panel: true,
    });
    assert.equal(planPanelKeyAction({ key: 'j', blocked: false, panelOpen: true, focusedId: 'citations', visibleIds: ids }).type, 'move');
    assert.equal((planPanelKeyAction({ key: 'j', blocked: false, panelOpen: true, focusedId: 'citations', visibleIds: ids }) as { taskId: string }).taskId, 'citations');
    assert.deepEqual(planPanelKeyAction({ key: 'Enter', blocked: false, panelOpen: false, focusedId: 'kitchen', visibleIds: ids }), {
        type: 'open',
        taskId: 'kitchen',
    });
    assert.deepEqual(planPanelKeyAction({ key: 'Escape', blocked: false, panelOpen: true, focusedId: 'kitchen', visibleIds: ids }), {
        type: 'close',
    });
    assert.equal(planPanelKeyAction({ key: 'j', blocked: true, panelOpen: true, focusedId: 'kitchen', visibleIds: ids }).type, 'none');
    assert.equal(planPanelKeyAction({ key: 'Escape', blocked: true, panelOpen: true, focusedId: 'kitchen', visibleIds: ids }).type, 'none');
    assert.equal(planPanelKeyAction({ key: 'Escape', blocked: false, panelOpen: false, focusedId: 'kitchen', visibleIds: ids }).type, 'none');
    assert.equal(planPanelKeyAction({ key: 'Enter', blocked: false, panelOpen: false, focusedId: null, visibleIds: ids }).type, 'none');
    assert.equal(planPanelKeyAction({ key: 'x', blocked: false, panelOpen: true, focusedId: 'kitchen', visibleIds: ids }).type, 'none');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { TASK_STATUS_LABELS } from '../copy/labels.ts';
import {
    EMPTY_PLAN_FILTERS,
    PLAN_FILTER_STATUS_OPTIONS,
    PLAN_QUICK_VIEWS,
    activePlanFilterCount,
    filterPlanTasks,
    filtersForPreset,
    hrefWithPlanFilters,
    matchingPlanPreset,
    planFilterCountLabel,
    planFilterEmptyCopy,
    readPlanFilters,
    type PlanFilterTask,
    type PlanFilterUrlState,
} from './plan-filters.ts';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const RANK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function task(overrides: Partial<PlanFilterTask> & Pick<PlanFilterTask, 'id' | 'title'>): PlanFilterTask {
    return {
        status: 'todo',

        parentTaskId: null,
        initiativeId: null,
        assigneeIds: [],
        priority: 'medium',
        ...overrides,
    };
}

function state(overrides: Partial<PlanFilterUrlState> = {}): PlanFilterUrlState {
    return { ...EMPTY_PLAN_FILTERS, query: '', ...overrides };
}

const page = task({ id: 'page', title: 'Rewrite the service page', status: 'todo', priority: 'high', assigneeIds: [ME], initiativeId: RANK });
const heading = task({ id: 'heading', title: 'Check one heading', status: 'in_progress', priority: 'low', parentTaskId: 'page', assigneeIds: [OTHER], stage: 'foundation' });
const footer = task({ id: 'footer', title: 'Fix the footer', status: 'in_progress', priority: 'high', assigneeIds: [ME], initiativeId: null });
const later = task({ id: 'later', title: 'Plan the next city page', status: 'done', priority: 'medium', assigneeIds: [], stage: 'backlog' });
const rows = [page, heading, footer, later];

test('filters combine, and a nested task keeps its main task', () => {
    const openHigh = filterPlanTasks(rows, { ...EMPTY_PLAN_FILTERS, status: 'in_progress', priority: 'high' });
    assert.deepEqual(openHigh.map(item => item.id), ['footer']);

    const mine = filterPlanTasks(rows, { ...EMPTY_PLAN_FILTERS, assignee: ME, status: 'todo' });
    assert.deepEqual(mine.map(item => item.id), ['page']);

    const childOnly = filterPlanTasks(rows, { ...EMPTY_PLAN_FILTERS, status: 'in_progress', priority: 'low' });
    assert.deepEqual(childOnly.map(item => item.id), ['page', 'heading']);

    const part = filterPlanTasks(rows, { ...EMPTY_PLAN_FILTERS, partOf: RANK, status: 'todo' });
    assert.deepEqual(part.map(item => item.id), ['page']);

    const nobody = filterPlanTasks(rows, { ...EMPTY_PLAN_FILTERS, assignee: 'none' });
    assert.deepEqual(nobody.map(item => item.id), ['later']);

    assert.deepEqual(filterPlanTasks(rows, EMPTY_PLAN_FILTERS).map(item => item.id), rows.map(item => item.id));
});

test('the address bar round-trips filters and ignores junk', () => {
    const href = hrefWithPlanFilters(
        '/workspace/harbor?tab=campaign&overviewMonth=2026-11&overviewTask=page&planStage=growth#plan',
        state({
            query: '  service page  ',
            status: 'in_progress',
            priority: 'high',
            assignee: ME,

            partOf: RANK,
        }),
    );
    assert.match(href, /^\/workspace\/harbor\?/);
    assert.match(href, /tab=campaign/);
    assert.match(href, /overviewMonth=2026-11/);
    assert.match(href, /overviewTask=page/);
    assert.match(href, /#plan$/);
    assert.doesNotMatch(href, /planStage/);
    const read = readPlanFilters(href.split('#')[0]?.split('?')[1] ?? '');
    assert.equal(read.query, 'service page');
    assert.equal(read.filters.status, 'in_progress');
    assert.equal(read.filters.priority, 'high');
    assert.equal(read.filters.assignee, ME);
    assert.equal(read.filters.partOf, RANK);

    const junk = readPlanFilters('?planStatus=blocked&planPriority=critical&planAssignee=abel&planStage=month_9&planPart=not-an-id&planQ=%20%20');
    assert.deepEqual(junk.filters, EMPTY_PLAN_FILTERS);
    assert.equal(junk.query, '');

    const cleared = hrefWithPlanFilters(href, state());
    assert.equal(new URL(cleared, 'https://seo-ops-center.local').searchParams.get('planStatus'), null);
    assert.match(cleared, /overviewMonth=2026-11/);
    assert.match(cleared, /tab=campaign/);
});

test('quick views are presets, and Clear is the empty filter set', () => {
    assert.deepEqual(filtersForPreset('not-started', ME), { ...EMPTY_PLAN_FILTERS, status: 'todo' });
    assert.deepEqual(filtersForPreset('in-progress', ME), { ...EMPTY_PLAN_FILTERS, status: 'in_progress' });
    assert.deepEqual(filtersForPreset('done', ME), { ...EMPTY_PLAN_FILTERS, status: 'done' });
    assert.deepEqual(filtersForPreset('mine', ME), { ...EMPTY_PLAN_FILTERS, assignee: ME });
    assert.equal(filtersForPreset('mine', ''), null);

    assert.equal(matchingPlanPreset(state({ status: 'todo' }), ME), 'not-started');
    assert.equal(matchingPlanPreset(state({ status: 'in_progress' }), ME), 'in-progress');
    assert.equal(matchingPlanPreset(state({ status: 'done' }), ME), 'done');
    assert.equal(matchingPlanPreset(state({ assignee: ME }), ME), 'mine');
    assert.equal(matchingPlanPreset(state({ assignee: ME, status: 'done' }), ME), '');
    assert.equal(matchingPlanPreset(state({ assignee: OTHER }), ME), '');
    assert.equal(matchingPlanPreset(state({ status: 'todo', query: 'page' }), ME), '');
    assert.equal(matchingPlanPreset(state(), ME), '');

    assert.equal(activePlanFilterCount(state()), 0);
    assert.equal(activePlanFilterCount(state({ query: 'page', status: 'todo', stage: 'this_month' })), 2);
    assert.equal(activePlanFilterCount(state({ partOf: RANK }), false), 0);
    assert.equal(planFilterCountLabel(1), '1 filter');
    assert.equal(planFilterCountLabel(3), '3 filters');
});

test('empty copy stays plain and a title search keeps its own sentence', () => {
    assert.equal(planFilterEmptyCopy(state({ query: 'citations' })),  'No tasks match "citations".' );
    assert.equal(planFilterEmptyCopy(state({ partOf: RANK })), 'No tasks in this project.');
    assert.equal(planFilterEmptyCopy(state({ status: 'done', query: 'page' })), 'No tasks match these filters.');
    assert.equal(planFilterEmptyCopy(state({ assignee: 'none' })), 'No tasks match these filters.');
    assert.equal(PLAN_QUICK_VIEWS.find(view => view.id === 'not-started')?.label, TASK_STATUS_LABELS.todo);
    assert.equal(PLAN_QUICK_VIEWS.find(view => view.id === 'in-progress')?.label, TASK_STATUS_LABELS.in_progress);
    assert.equal(PLAN_FILTER_STATUS_OPTIONS.map(option => option.label).join('|'), 'To Do|In Progress|Done');
});

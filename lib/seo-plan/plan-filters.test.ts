import assert from 'node:assert/strict';
import test from 'node:test';

import { planSearchMissCopy } from './plan-sections.ts';
import {
    EMPTY_PLAN_FILTERS,
    activePlanFilterCount,
    describeFilteredSections,
    filterPlanTasks,
    filtersForPreset,
    hideSectionsOutsideStage,
    hrefWithPlanFilters,
    matchingPlanPreset,
    planFilterCountLabel,
    planFilterEmptyCopy,
    planSectionFilterEmpty,
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
        stage: 'foundation',
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

const page = task({ id: 'page', title: 'Rewrite the service page', status: 'todo', priority: 'high', assigneeIds: [ME], stage: 'foundation', initiativeId: RANK });
const heading = task({ id: 'heading', title: 'Check one heading', status: 'in_progress', priority: 'low', parentTaskId: 'page', assigneeIds: [OTHER], stage: 'foundation' });
const footer = task({ id: 'footer', title: 'Fix the footer', status: 'in_progress', priority: 'high', assigneeIds: [ME], stage: 'growth', initiativeId: null });
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

test('a stage change hides a task that no longer matches, and keeps one that still does', () => {
    const column = (stage: string | null) => ({
        id: stage === 'backlog' ? 'foundation' : stage ?? 'foundation',
        title: stage ?? 'Foundation',
        groups: [{ task: { stage } }],
        count: 1,
        open: 1,
        late: 0,
        done: 0,
        meta: '1 open',
        empty: 'None',
    });
    const parked = hideSectionsOutsideStage(
        [column('foundation'), column('growth'), column('scale'), { ...column('backlog'), groups: [{ task: { stage: 'backlog' } }] }],
        'foundation',
        'phases',
    );
    assert.deepEqual(parked.map(section => section.groups.length), [1, 0, 0, 0]);
    const moved = hideSectionsOutsideStage(
        [column('foundation'), { ...column('growth'), groups: [{ task: { stage: 'growth' } }] }, column('scale')],
        'foundation',
        'phases',
    );
    assert.equal(moved.find(section => section.id === 'growth')?.groups.length, 0);
    const still = filterPlanTasks([{ ...page, stage: 'growth' }], { ...EMPTY_PLAN_FILTERS, status: 'todo' });
    assert.deepEqual(still.map(item => item.id), ['page']);
});

test('the month board can hide every column except the chosen stage', () => {
    const sections = [
        { id: 'onboarding', title: 'Onboarding', groups: [{ task: { stage: 'onboarding' } }], count: 1, open: 1, late: 0, done: 0, meta: '1 open', empty: 'None' },
        { id: 'this_month', title: 'This month', groups: [{ task: { stage: 'backlog' } }], count: 1, open: 1, late: 0, done: 0, meta: '1 open', empty: 'None' },
        { id: 'backlog', title: 'Backlog', groups: [{ task: { stage: 'backlog' } }], count: 1, open: 1, late: 0, done: 0, meta: '1', empty: 'None' },
    ];
    const laterOnly = hideSectionsOutsideStage(sections, 'backlog', 'months');
    assert.deepEqual(laterOnly.map(section => section.groups.length), [0, 0, 1]);
    assert.equal(laterOnly[2]?.groups.length, 1);
    const described = describeFilteredSections(laterOnly, true);
    assert.equal(described[0]?.empty, planSectionFilterEmpty('Onboarding'));
    assert.equal(described[0]?.meta, 'No matching tasks');
    assert.equal(described[2]?.empty, 'None');
    assert.deepEqual(hideSectionsOutsideStage(sections, 'foundation', 'months').map(section => section.groups.length), [1, 1, 1]);
    assert.deepEqual(hideSectionsOutsideStage(sections, 'this_month', 'phases').map(section => section.groups.length), [1, 1, 1]);
});

test('the address bar round-trips filters and ignores junk', () => {
    const href = hrefWithPlanFilters(
        '/workspace/harbor?tab=campaign&overviewMonth=2026-11&overviewTask=page#plan',
        state({
            query: '  service page  ',
            status: 'in_progress',
            priority: 'high',
            assignee: ME,
            stage: 'growth',
            partOf: RANK,
        }),
    );
    assert.match(href, /^\/workspace\/harbor\?/);
    assert.match(href, /tab=campaign/);
    assert.match(href, /overviewMonth=2026-11/);
    assert.match(href, /overviewTask=page/);
    assert.match(href, /#plan$/);
    const read = readPlanFilters(href.split('#')[0]?.split('?')[1] ?? '');
    assert.equal(read.query, 'service page');
    assert.equal(read.filters.status, 'in_progress');
    assert.equal(read.filters.priority, 'high');
    assert.equal(read.filters.assignee, ME);
    assert.equal(read.filters.stage, 'growth');
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

    assert.equal(activePlanFilterCount(state(), 'phases'), 0);
    assert.equal(activePlanFilterCount(state({ query: 'page', status: 'todo', stage: 'this_month' }), 'phases'), 2);
    assert.equal(activePlanFilterCount(state({ stage: 'backlog', partOf: RANK }), 'phases', false), 1);
    assert.equal(planFilterCountLabel(1), '1 filter');
    assert.equal(planFilterCountLabel(3), '3 filters');
});

test('empty copy stays plain and a title search keeps its own sentence', () => {
    assert.equal(planFilterEmptyCopy(state({ query: 'citations' })), planSearchMissCopy('citations'));
    assert.equal(planFilterEmptyCopy(state({ partOf: RANK })), 'No tasks are part of this.');
    assert.equal(planFilterEmptyCopy(state({ status: 'done', query: 'page' })), 'No tasks match these filters.');
    assert.equal(planFilterEmptyCopy(state({ assignee: 'none' })), 'No tasks match these filters.');
});

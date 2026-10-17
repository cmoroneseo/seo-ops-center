import assert from 'node:assert/strict';
import test from 'node:test';

import {
    compareStageListTasks,
    groupTasksByStage,
    parseStageListTasks,
    stageListTaskFromRow,
    stageListTitleParts,
    type StageListTask,
} from './stage-list.ts';
import { TASK_STAGES } from '../types.ts';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'backlog',
        position: null,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

const setup = task({
    id: 'setup',
    title: 'SEO Setup',
    stage: 'onboarding',
    position: 1,
    category: 'admin',
    createdAt: '2026-01-02T00:00:00.000Z',
});
const keywords = task({
    id: 'keywords',
    title: 'Add keywords to Position tracking',
    stage: 'onboarding',
    position: 2,
    parentTaskId: 'setup',
    basecamp: true,
    createdAt: '2026-01-03T00:00:00.000Z',
});
const cookies = task({
    id: 'cookies',
    title: 'Set Up Empire Cookies',
    stage: 'month_1',
    position: 1,
    parentTaskId: 'setup',
    basecamp: true,
    createdAt: '2026-01-04T00:00:00.000Z',
});
const roadmap = task({
    id: 'roadmap',
    title: 'Create SEO Roadmap & Recommendations List',
    stage: 'onboarding',
    position: 2,
    basecamp: true,
    createdAt: '2026-01-05T00:00:00.000Z',
});
const robots = task({
    id: 'robots',
    title: 'Review robots.txt and XML sitemap',
    stage: 'month_1',
    position: 1,
    category: 'technical',
    createdAt: '2026-02-01T00:00:00.000Z',
});

const floor = [setup, keywords, cookies, roadmap, robots];

function section(name: string, tasks: StageListTask[] = floor, query = '') {
    const found = groupTasksByStage(tasks, query).find(item => item.stage === name);
    if (!found) throw new Error(`missing section ${name}`);
    return found;
}

test('sections follow TASK_STAGES and empty stages still render', () => {
    const sections = groupTasksByStage(floor, '');
    assert.deepEqual(sections.map(item => item.stage), [...TASK_STAGES]);
    assert.deepEqual(sections.map(item => item.label), ['Onboarding', 'Month 1', 'Month 2', 'Month 3', 'Backlog']);
    assert.equal(section('month_2').count, 0);
    assert.deepEqual(section('month_2').groups, []);
    assert.equal(section('month_3').count, 0);
    assert.equal(section('backlog').count, 0);
});

test('pillars nest subtasks and subtasks are not peer rows', () => {
    const onboarding = section('onboarding');
    assert.deepEqual(onboarding.groups.map(group => group.task.id), ['setup', 'roadmap']);
    assert.equal(onboarding.count, 2);
    const pillar = onboarding.groups[0];
    assert.deepEqual(pillar.children.map(child => child.id), ['cookies', 'keywords']);
    assert.equal(pillar.childCount, 2);
    assert.equal(pillar.expandChildren, false);
    assert.equal(section('month_1').groups.map(group => group.task.id).includes('cookies'), false);
    assert.deepEqual(section('month_1').groups.map(group => group.task.id), ['robots']);
    const peerIds = groupTasksByStage(floor, '').flatMap(item => item.groups.map(group => group.task.id));
    assert.equal(peerIds.includes('cookies'), false);
    assert.equal(peerIds.includes('keywords'), false);
});

test('position orders rows, then created_at, then id', () => {
    const later = task({ id: 'b', title: 'Later id', stage: 'month_2', position: 1, createdAt: '2026-03-01T00:00:00.000Z' });
    const earlier = task({ id: 'a', title: 'Earlier id', stage: 'month_2', position: 1, createdAt: '2026-03-01T00:00:00.000Z' });
    const second = task({ id: 'second', title: 'Second position', stage: 'month_2', position: 2, createdAt: '2026-01-01T00:00:00.000Z' });
    const unpositioned = task({ id: 'loose', title: 'No position', stage: 'month_2', position: null, createdAt: '2026-01-01T00:00:00.000Z' });
    const older = task({ id: 'older', title: 'Older', stage: 'backlog', position: 4, createdAt: '2026-01-01T00:00:00.000Z' });
    const newer = task({ id: 'newer', title: 'Newer', stage: 'backlog', position: 4, createdAt: '2026-06-01T00:00:00.000Z' });
    const month = section('month_2', [second, unpositioned, later, earlier]);
    assert.deepEqual(month.groups.map(group => group.task.id), ['a', 'b', 'second', 'loose']);
    assert.deepEqual(section('backlog', [newer, older]).groups.map(group => group.task.id), ['older', 'newer']);
    assert.equal(compareStageListTasks(earlier, later) < 0, true);
});

test('unknown and missing stages land in backlog', () => {
    const unknown = task({ id: 'mystery', title: 'Mystery', stage: 'month_4', position: 1 });
    const blank = task({ id: 'blank', title: 'Blank', stage: null, position: 2 });
    assert.deepEqual(section('backlog', [unknown, blank]).groups.map(group => group.task.id), ['mystery', 'blank']);
});

test('a subtask-only match shows the parent with matching children expanded', () => {
    const onboarding = section('onboarding', floor, 'cookies');
    assert.deepEqual(onboarding.groups.map(group => group.task.id), ['setup']);
    assert.equal(onboarding.groups[0].expandChildren, true);
    assert.deepEqual(onboarding.groups[0].children.map(child => child.id), ['cookies']);
    assert.equal(onboarding.groups[0].childCount, 2);
    assert.equal(section('onboarding', floor, 'cookies').groups.some(group => group.task.id === 'roadmap'), false);
    assert.equal(section('month_1', floor, 'cookies').count, 0);
});

test('a pillar title match keeps its children collapsed until a subtask title also matches', () => {
    const collapsed = section('onboarding', floor, 'seo setup');
    assert.deepEqual(collapsed.groups.map(group => group.task.id), ['setup']);
    assert.equal(collapsed.groups[0].expandChildren, false);
    assert.deepEqual(collapsed.groups[0].children.map(child => child.id), ['cookies', 'keywords']);

    const opened = section('onboarding', floor, 'set');
    assert.equal(opened.groups[0].task.id, 'setup');
    assert.equal(opened.groups[0].expandChildren, true);
    assert.deepEqual(opened.groups[0].children.map(child => child.title), [
        'Set Up Empire Cookies',
        'Add keywords to Position tracking',
    ]);
});

test('search matches every word in a title and ignores a client name that is not in the title', () => {
    assert.equal(section('onboarding', floor, 'empire cookies').groups[0]?.children[0]?.id, 'cookies');
    assert.equal(section('onboarding', floor, 'COOKIES').groups[0]?.expandChildren, true);
    const missed = groupTasksByStage(floor, 'floor co');
    assert.equal(missed.every(item => item.count === 0), true);
    assert.equal(missed.length, 5);
    const blank = groupTasksByStage(floor, '   ');
    assert.equal(blank.find(item => item.stage === 'onboarding')?.count, 2);
});

test('a recurring successor stays its own row, and a grandchild nests under the pillar', () => {
    const successor = task({
        id: 'successor',
        title: 'SEO Setup',
        stage: 'month_2',
        position: 1,
        parentTaskId: 'setup',
        recurring: true,
    });
    const middle = task({
        id: 'middle',
        title: 'Middle chore',
        stage: 'onboarding',
        position: 3,
        parentTaskId: 'setup',
    });
    const grand = task({
        id: 'grand',
        title: 'Grand chore',
        stage: 'backlog',
        position: 1,
        parentTaskId: 'middle',
    });
    const sections = groupTasksByStage([setup, successor, middle, grand], '');
    const onboarding = sections.find(item => item.stage === 'onboarding');
    assert.deepEqual(onboarding?.groups[0].children.map(child => child.id), ['grand', 'middle']);
    assert.equal(sections.find(item => item.stage === 'month_2')?.groups[0].task.id, 'successor');
    assert.equal(sections.flatMap(item => item.groups.map(group => group.task.id)).includes('grand'), false);
});

test('a subtask with no loaded parent is not a peer pillar', () => {
    const orphan = task({
        id: 'orphan',
        title: 'Set Up Empire Cookies',
        stage: 'onboarding',
        position: 1,
        parentTaskId: 'missing',
    });
    const onboarding = section('onboarding', [orphan, roadmap]);
    const row = onboarding.groups.find(group => group.task.id === 'orphan');
    assert.equal(row?.parentBreadcrumb, 'Under another task');
    assert.deepEqual(row?.children, []);
    assert.equal(onboarding.groups.some(group => group.children.some(child => child.id === 'orphan')), false);
});

test('duplicate ids keep the first row', () => {
    const copy = task({ ...setup, title: 'Second copy' });
    assert.equal(section('onboarding', [setup, copy]).groups[0].task.title, 'SEO Setup');
});

test('title highlighting marks each matched word', () => {
    assert.deepEqual(stageListTitleParts('Set Up Empire Cookies', 'empire cookies'), [
        { text: 'Set Up ', match: false },
        { text: 'Empire', match: true },
        { text: ' ', match: false },
        { text: 'Cookies', match: true },
    ]);
    assert.deepEqual(stageListTitleParts('SEO Setup', '   '), [{ text: 'SEO Setup', match: false }]);
});

test('row mapping keeps stage fields and drops the recurrence payload', () => {
    const mapped = stageListTaskFromRow({
        id: 'setup',
        title: 'SEO Setup',
        status: 'in_progress',
        stage: 'onboarding',
        position: 1.5,
        parent_task_id: null,
        created_at: '2026-01-02T00:00:00.000Z',
        category: 'admin',
        basecamp_todo_id: 10228422582,
        recurrence: { freq: 'weekly', interval: 1 },
    });
    assert.equal(mapped?.stage, 'onboarding');
    assert.equal(mapped?.position, 1.5);
    assert.equal(mapped?.basecamp, true);
    assert.equal(mapped?.recurring, true);
    assert.equal(mapped?.publishedUrl, undefined);
    assert.equal(JSON.stringify(mapped).includes('weekly'), false);
    assert.equal(stageListTaskFromRow({
        id: 'piece',
        title: 'Chino service page',
        published_url: ' https://example.com/chino ',
    })?.publishedUrl, 'https://example.com/chino');

    assert.equal(stageListTaskFromRow({ id: '', title: 'Nope' }), null);
    assert.equal(stageListTaskFromRow({ id: 'x' }), null);
    const invalid = stageListTaskFromRow({ id: 'x', title: 'Loose', stage: 'month_4', position: Number.NaN });
    assert.equal(invalid?.stage, 'month_4');
    assert.equal(invalid?.position, null);
});

test('JSON parsing keeps camelCase task fields and drops junk', () => {
    const parsed = parseStageListTasks([
        {
            id: 'setup',
            title: 'SEO Setup',
            status: 'todo',
            stage: 'onboarding',
            position: 1,
            parentTaskId: null,
            createdAt: '2026-01-02T00:00:00.000Z',
            category: 'admin',
            basecamp: true,
            recurring: false,
            organizationId: 'should-drop',
        },
        { id: 4, title: 'nope' },
        null,
    ]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].basecamp, true);
    assert.equal('organizationId' in parsed[0], false);
    assert.deepEqual(parseStageListTasks({ tasks: [] }), []);
});

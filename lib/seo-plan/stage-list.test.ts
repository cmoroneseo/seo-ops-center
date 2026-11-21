import assert from 'node:assert/strict';
import test from 'node:test';

import {
    compareStageListTasks,
    groupTaskTrees,
    parseStageListTasks,
    stageListTaskFromRow,
    stageListTitleParts,
    type StageListTask,
} from './stage-list.ts';
import { subtaskProgress } from '../tasks/subtask-progress.ts';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',

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

    position: 1,
    category: 'admin',
    createdAt: '2026-01-02T00:00:00.000Z',
});
const keywords = task({
    id: 'keywords',
    title: 'Add keywords to Position tracking',

    position: 2,
    parentTaskId: 'setup',
    basecamp: true,
    createdAt: '2026-01-03T00:00:00.000Z',
});
const cookies = task({
    id: 'cookies',
    title: 'Set Up Empire Cookies',

    position: 1,
    parentTaskId: 'setup',
    basecamp: true,
    createdAt: '2026-01-04T00:00:00.000Z',
});
const roadmap = task({
    id: 'roadmap',
    title: 'Create SEO Roadmap & Recommendations List',

    position: 2,
    basecamp: true,
    createdAt: '2026-01-05T00:00:00.000Z',
});
const robots = task({
    id: 'robots',
    title: 'Review robots.txt and XML sitemap',

    position: 1,
    category: 'technical',
    createdAt: '2026-02-01T00:00:00.000Z',
});

const floor = [setup, keywords, cookies, roadmap, robots];

test('pillars nest subtasks and subtasks are not peer rows', () => {
    const onboarding = { groups: groupTaskTrees(floor, '') };
    assert.deepEqual(onboarding.groups.map(group => group.task.id), ['setup', 'robots', 'roadmap']);
    const pillar = onboarding.groups[0];
    assert.deepEqual(pillar.children.map(child => child.id), ['cookies', 'keywords']);
    assert.equal(pillar.childCount, 2);
    assert.equal(pillar.expandChildren, false);
    assert.equal(groupTaskTrees(floor, '').map(group => group.task.id).includes('cookies'), false);
    const peerIds = groupTaskTrees(floor, '').map(group => group.task.id);
    assert.equal(peerIds.includes('cookies'), false);
    assert.equal(peerIds.includes('keywords'), false);
});

test('position orders rows, then created_at, then id', () => {
    const later = task({ id: 'b', title: 'Later id', position: 1, createdAt: '2026-03-01T00:00:00.000Z' });
    const earlier = task({ id: 'a', title: 'Earlier id', position: 1, createdAt: '2026-03-01T00:00:00.000Z' });
    const second = task({ id: 'second', title: 'Second position', position: 2, createdAt: '2026-01-01T00:00:00.000Z' });
    const unpositioned = task({ id: 'loose', title: 'No position', position: null, createdAt: '2026-01-01T00:00:00.000Z' });
    const older = task({ id: 'older', title: 'Older', position: 4, createdAt: '2026-01-01T00:00:00.000Z' });
    const newer = task({ id: 'newer', title: 'Newer', position: 4, createdAt: '2026-06-01T00:00:00.000Z' });
    const month = { groups: groupTaskTrees([second, unpositioned, later, earlier], '') };
    assert.deepEqual(month.groups.map(group => group.task.id), ['a', 'b', 'second', 'loose']);
    assert.deepEqual(groupTaskTrees([newer, older], '').map(group => group.task.id), ['older', 'newer']);
    assert.equal(compareStageListTasks(earlier, later) < 0, true);
});

test('a subtask-only match shows the parent with matching children expanded', () => {
    const onboarding = { groups: groupTaskTrees(floor, 'cookies') };
    assert.deepEqual(onboarding.groups.map(group => group.task.id), ['setup']);
    assert.equal(onboarding.groups[0].expandChildren, true);
    assert.deepEqual(onboarding.groups[0].children.map(child => child.id), ['cookies']);
    assert.equal(onboarding.groups[0].childCount, 2);
    assert.equal(groupTaskTrees(floor, 'cookies').some(group => group.task.id === 'roadmap'), false);
});

test('a pillar title match keeps its children collapsed until a subtask title also matches', () => {
    const collapsed = { groups: groupTaskTrees(floor, 'seo setup') };
    assert.deepEqual(collapsed.groups.map(group => group.task.id), ['setup']);
    assert.equal(collapsed.groups[0].expandChildren, false);
    assert.deepEqual(collapsed.groups[0].children.map(child => child.id), ['cookies', 'keywords']);

    const opened = { groups: groupTaskTrees(floor, 'set') };
    assert.equal(opened.groups[0].task.id, 'setup');
    assert.equal(opened.groups[0].expandChildren, true);
    assert.deepEqual(opened.groups[0].children.map(child => child.title), [
        'Set Up Empire Cookies',
        'Add keywords to Position tracking',
    ]);
});

test('search matches every word in a title and ignores a client name that is not in the title', () => {
    assert.equal(groupTaskTrees(floor, 'empire cookies')[0]?.children[0]?.id, 'cookies');
    assert.equal(groupTaskTrees(floor, 'COOKIES')[0]?.expandChildren, true);
});

test('a recurring successor stays its own row, and a grandchild nests under the pillar', () => {
    const successor = task({
        id: 'successor',
        title: 'SEO Setup',

        position: 1,
        parentTaskId: 'setup',
        recurring: true,
    });
    const middle = task({
        id: 'middle',
        title: 'Middle chore',

        position: 3,
        parentTaskId: 'setup',
    });
    const grand = task({
        id: 'grand',
        title: 'Grand chore',

        position: 1,
        parentTaskId: 'middle',
    });
    const sections = groupTaskTrees([setup, successor, middle, grand], '');
    const onboarding = { groups: sections.filter(item => item.task.id === 'setup') };
    assert.deepEqual(onboarding?.groups[0].children.map(child => child.id), ['grand', 'middle']);
    assert.equal(sections.find(item => item.task.id === 'successor')?.task.id, 'successor');
    assert.equal(sections.map(group => group.task.id).includes('grand'), false);
});

test('SEO Setup progress matches the shared live set and drops recurring and excluded rows', () => {
    const sitemap = task({
        id: 'sitemap',
        title: 'Submit sitemap',

        position: 4,
        parentTaskId: 'setup',
    });
    const robotsChild = task({ ...robots, parentTaskId: 'setup', status: 'done', stage: 'onboarding' });
    const grand = task({
        id: 'grand',
        title: 'Confirm sitemap index',

        position: 1,
        parentTaskId: 'sitemap',
    });
    const successor = task({
        id: 'successor',
        title: 'SEO Setup',

        position: 1,
        parentTaskId: 'setup',
        recurring: true,
    });
    const archived = task({
        id: 'old',
        title: 'Retired checklist row',

        position: 5,
        parentTaskId: 'setup',
        status: 'done',
        excluded: true,
    });
    const rows = [
        setup,
        task({ ...keywords, status: 'done' }),
        task({ ...cookies, status: 'done' }),
        robotsChild,
        sitemap,
        grand,
        successor,
        archived,
    ];
    const pillar = groupTaskTrees(rows, '').find(group => group.task.id === 'setup');
    const shared = subtaskProgress('setup', rows);
    assert.equal(shared.label, '3/5');
    assert.equal(pillar?.childCount, shared.total);
    assert.equal(pillar?.childDone, shared.done);
    assert.equal(pillar?.children.some(child => child.id === 'grand'), true);
    assert.equal(pillar?.children.some(child => child.id === 'successor'), false);
    assert.equal(pillar?.children.some(child => child.id === 'old'), false);
});

test('a subtask with no loaded parent is not a peer pillar', () => {
    const orphan = task({
        id: 'orphan',
        title: 'Set Up Empire Cookies',

        position: 1,
        parentTaskId: 'missing',
    });
    const onboarding = { groups: groupTaskTrees([orphan, roadmap], '') };
    const row = onboarding.groups.find(group => group.task.id === 'orphan');
    assert.equal(row?.parentBreadcrumb, 'Under another task');
    assert.deepEqual(row?.children, []);
    assert.equal(onboarding.groups.some(group => group.children.some(child => child.id === 'orphan')), false);
});

test('duplicate ids keep the first row', () => {
    const copy = task({ ...setup, title: 'Second copy' });
    assert.equal(groupTaskTrees([setup, copy], '')[0].task.title, 'SEO Setup');
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

test('row mapping keeps task fields and drops the recurrence payload', () => {
    const mapped = stageListTaskFromRow({
        id: 'setup',
        title: 'SEO Setup',
        status: 'in_progress',

        position: 1.5,
        parent_task_id: null,
        created_at: '2026-01-02T00:00:00.000Z',
        category: 'admin',
        basecamp_todo_id: 10228422582,
        recurrence: { freq: 'weekly', interval: 1 },
    });
    assert.equal(mapped?.position, 1.5);
    assert.equal(mapped?.basecamp, true);
    assert.equal(mapped?.recurring, true);
    assert.equal(mapped?.publishedUrl, undefined);
    assert.equal(mapped?.dueDate, undefined);
    assert.equal(JSON.stringify(mapped).includes('weekly'), false);
    assert.equal(stageListTaskFromRow({
        id: 'piece',
        title: 'Chino service page',
        published_url: ' https://example.com/chino ',
    })?.publishedUrl, 'https://example.com/chino');
    assert.equal(stageListTaskFromRow({
        id: 'dated',
        title: 'Dated',
        due_date: '2026-10-31T00:00:00.000Z',
    })?.dueDate, '2026-10-31');
    assert.equal(stageListTaskFromRow({ id: 'empty', title: 'Empty', due_date: null })?.dueDate, null);
    assert.equal(stageListTaskFromRow({ id: 'held', title: 'Held', blocked_reason: ' Waiting on client ' })?.blockedReason, 'Waiting on client');
    assert.equal(stageListTaskFromRow({ id: 'open', title: 'Open', blocked_reason: '  ' })?.blockedReason, null);
    assert.equal(stageListTaskFromRow({ id: 'plain', title: 'Plain' })?.blockedReason, undefined);
    assert.equal(stageListTaskFromRow({ id: 'hot', title: 'Hot', priority: 'high' })?.priority, 'high');
    assert.equal(stageListTaskFromRow({ id: 'plain', title: 'Plain' })?.priority, undefined);
    assert.equal(stageListTaskFromRow({ id: 'junk', title: 'Junk', priority: 'critical' })?.priority, null);

    assert.equal(stageListTaskFromRow({ id: '', title: 'Nope' }), null);
    assert.equal(stageListTaskFromRow({ id: 'x' }), null);
    const invalid = stageListTaskFromRow({ id: 'x', title: 'Loose', position: Number.NaN });
    assert.deepEqual(groupTaskTrees(floor, 'unknown client'), []);
    assert.equal(invalid?.position, null);
});

test('JSON parsing keeps camelCase task fields and drops junk', () => {
    const parsed = parseStageListTasks([
        {
            id: 'setup',
            title: 'SEO Setup',
            status: 'todo',

            position: 1,
            parentTaskId: null,
            createdAt: '2026-01-02T00:00:00.000Z',
            category: 'admin',
            basecamp: true,
            recurring: false,
            dueDate: '2026-10-04',
            blockedReason: ' Waiting on client ',
            priority: 'urgent',
            organizationId: 'should-drop',
        },
        { id: 4, title: 'nope' },
        null,
    ]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].basecamp, true);
    assert.equal(parsed[0].dueDate, '2026-10-04');
    assert.equal(parsed[0].blockedReason, 'Waiting on client');
    assert.equal(parsed[0].priority, 'urgent');
    assert.equal('organizationId' in parsed[0], false);
    assert.deepEqual(parseStageListTasks({ tasks: [] }), []);
});

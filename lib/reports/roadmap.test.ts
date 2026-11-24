/**
 * Run with: node --import tsx --test lib/reports/roadmap.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { StageListTask } from '../seo-plan/stage-list.ts';
import {
    CLIENT_ROADMAP_KEYS,
    CLIENT_ROADMAP_GROUP_KEYS,
    CLIENT_ROADMAP_TASK_KEYS,
    clientSafeDescription,
    presentRoadmap,
    projectClientRoadmap,
    readRoadmapBlockOptions,
    type ClientRoadmap,
} from './roadmap.ts';

const EMAIL = 'abel@marketingempiregroup.com';
const SUBTASK = 'Subtask secret zebra';
const HOURS = '7.5';
const ASSIGNEE = 'user-secret-id-9f3a';
const BLOCKED = 'Waiting on the owner login';
const NOTE = 'Basecamp push failed with a private token';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'foundation',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        dueDate: null,
        completedAt: null,
        assigneeIds: [ASSIGNEE],
        blockedReason: BLOCKED,
        description: `Internal note for ${EMAIL}. Budget ${HOURS} hours. ${NOTE}`,
        estimatedHours: 7.5,
        publishedUrl: 'https://staff.example/draft',
        basecampSync: { state: 'failed', error: NOTE, attemptedAt: '2026-11-01T00:00:00.000Z' },
        ...overrides,
    };
}

function assertAllowlist(roadmap: ClientRoadmap) {
    for (const key of Object.keys(roadmap)) {
        assert.ok((CLIENT_ROADMAP_KEYS as readonly string[]).includes(key), key);
    }
    for (const group of roadmap.groups) {
        for (const key of Object.keys(group)) {
            assert.ok((CLIENT_ROADMAP_GROUP_KEYS as readonly string[]).includes(key), key);
        }
        for (const row of group.tasks) {
            for (const key of Object.keys(row)) {
                assert.ok((CLIENT_ROADMAP_TASK_KEYS as readonly string[]).includes(key), key);
            }
        }
    }
}

test('projects keep their order and show client-friendly status and task progress', () => {
    const site = { id: 'site-secret-id', title: 'Website updates', state: 'in_progress', purpose: NOTE } as const;
    const roadmap = projectClientRoadmap({
        projects: [
            { id: 'pages-secret-id', title: 'New pages', state: 'awaiting_approval' },
            site,
            { id: 'planned-id', title: 'Search research', state: 'planned' },
            { id: 'blocked-id', title: 'Site access', state: 'blocked' },
            { id: 'hold-id', title: 'Redirects', state: 'on_hold' },
            { id: 'completed-id', title: 'Site launch', state: 'completed_verified' },
        ],
        tasks: [
            task({
                id: 'fix',
                initiativeId: site.id,
                title: `Fix the sitemap for ${EMAIL}`,
                status: 'done',
                completedAt: '2026-11-02T20:00:00.000Z',
                description: 'Make the sitemap so Google can read every page.',
            }),
            task({ id: 'review', title: 'Review the sitemap', initiativeId: site.id, status: 'review', position: 2 }),
            task({ id: 'child', title: SUBTASK, parentTaskId: 'fix' }),
            task({ id: 'orphan', title: 'Orphan secret task', parentTaskId: 'missing-parent' }),
            task({ id: 'archived', title: 'Archived secret task', excluded: true }),
            task({ id: 'pages', title: 'Write the service page', initiativeId: 'pages-secret-id', status: 'in_progress' }),
        ],
    });

    assert.deepEqual(roadmap.groups.map(({ title, status, progress }) => [title, status, progress]), [
        ['New pages', 'Waiting on your approval', '0 of 1 done'],
        ['Website updates', 'In progress', '1 of 2 done'],
        ['Search research', 'Planned', 'Nothing here yet'],
        ['Site access', 'Delayed', 'Nothing here yet'],
        ['Redirects', 'On hold', 'Nothing here yet'],
        ['Site launch', 'Done', 'Nothing here yet'],
    ]);
    assert.equal(roadmap.groups[1]?.done, 1);
    assert.equal(roadmap.groups[1]?.total, 2);
    assert.deepEqual(roadmap.groups[1]?.tasks, [
        {
            title: 'Fix the sitemap for',
            status: 'Done',
            doneOn: 'Nov 2',
            description: 'Make the sitemap so Google can read every page.',
        },
        { title: 'Review the sitemap', status: 'In review' },
    ]);
    assertAllowlist(roadmap);
    const serialized = JSON.stringify(roadmap);
    for (const secret of [EMAIL, SUBTASK, HOURS, ASSIGNEE, BLOCKED, NOTE, 'Archived secret', 'Orphan secret', 'secret-id', 'https://staff.example']) {
        assert.equal(serialized.includes(secret), false, secret);
    }
});

test('client-facing roadmaps say Delayed, not Blocked, for a blocked project', () => {
    const roadmap = projectClientRoadmap({
        projects: [{ id: 'access', title: 'Site access', state: 'blocked' }],
        tasks: [task({ id: 'login', title: 'Get site access', initiativeId: 'access' })],
    });
    assert.equal(roadmap.groups[0]?.status, 'Delayed');
    assert.equal(JSON.stringify(roadmap).includes('Blocked'), false);
});

test('unassigned tasks and tasks with unknown projects share a final Other work group', () => {
    const roadmap = projectClientRoadmap({
        projects: [{ id: 'site', title: 'Website updates', state: 'planned' }],
        tasks: [
            task({ id: 'a', title: 'Fix titles', initiativeId: 'site' }),
            task({ id: 'b', title: 'Check links', position: 1 }),
            task({ id: 'c', title: 'Check indexing', initiativeId: 'unknown-project', position: 2 }),
        ],
    });
    assert.deepEqual(roadmap.groups.map(group => group.title), ['Website updates', 'Other work']);
    assert.deepEqual(roadmap.groups[1]?.tasks.map(row => row.title), ['Check links', 'Check indexing']);
    assert.equal(roadmap.groups[1]?.progress, '0 of 2 done');
    assert.equal(roadmap.groups[1]?.status, undefined);
    assertAllowlist(roadmap);
});

test('descriptions with an email or an hour estimate are not client-safe', () => {
    assert.equal(clientSafeDescription('  Rewrite the service page.  '), 'Rewrite the service page.');
    assert.equal(clientSafeDescription(''), null);
    assert.equal(clientSafeDescription(`Ask ${EMAIL} to review`), null);
    assert.equal(clientSafeDescription('This takes 4 hours'), null);
    assert.equal(clientSafeDescription('This takes 2.5 hrs'), null);
    assert.equal(clientSafeDescription('Block 3h for the draft'), null);
    assert.equal(clientSafeDescription('the homepage'), 'the homepage');
});

test('legacy block options leave project groups visible and descriptions opt-in', () => {
    const roadmap = projectClientRoadmap({
        projects: [{ id: 'site', title: 'Website updates', state: 'planned' }],
        tasks: [
            task({ id: 'a', title: 'Fix titles', initiativeId: 'site', description: 'Short titles on the main pages.' }),
            task({ id: 'b', title: 'New page' }),
        ],
    });
    const options = readRoadmapBlockOptions({
        hiddenStages: ['foundation', 'growth', 'scale', 'onboarding', 'this_month', 'backlog'],
        tasks: [{ title: 'should not stick' }],
    });
    assert.deepEqual(options, { showTaskDescriptions: false });
    const shown = presentRoadmap(roadmap, options);
    assert.deepEqual(shown.groups.map(group => group.title), ['Website updates', 'Other work']);
    assert.equal(shown.groups[0]?.tasks[0]?.description, undefined);
    const described = presentRoadmap(roadmap, { showTaskDescriptions: true });
    assert.equal(described.groups[0]?.tasks[0]?.description, 'Short titles on the main pages.');
});

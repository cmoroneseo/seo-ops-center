/**
 * Run with: node --import tsx --test lib/reports/roadmap.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASE_STAGE_COPY } from '../seo-plan/plan-phases.ts';
import type { StageListTask } from '../seo-plan/stage-list.ts';
import {
    CLIENT_ROADMAP_KEYS,
    CLIENT_ROADMAP_STAGE_KEYS,
    CLIENT_ROADMAP_TASK_KEYS,
    CLIENT_STATUS_WORDS,
    ROADMAP_COPY,
    clientSafeDescription,
    presentRoadmap,
    projectClientRoadmap,
    readRoadmapBlockOptions,
    roadmapHasClientDescriptions,
} from './roadmap.ts';

const TODAY = '2026-11-10';
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

function assertAllowlist(roadmap: { stages: Array<Record<string, unknown> & { tasks: Array<Record<string, unknown>> }> }) {
    for (const key of Object.keys(roadmap)) {
        assert.ok((CLIENT_ROADMAP_KEYS as readonly string[]).includes(key), key);
    }
    for (const stage of roadmap.stages) {
        for (const key of Object.keys(stage)) {
            assert.ok((CLIENT_ROADMAP_STAGE_KEYS as readonly string[]).includes(key), key);
        }
        for (const row of stage.tasks) {
            for (const key of Object.keys(row)) {
                assert.ok((CLIENT_ROADMAP_TASK_KEYS as readonly string[]).includes(key), key);
            }
            assert.ok(Object.values(CLIENT_STATUS_WORDS).includes(row.status as typeof CLIENT_STATUS_WORDS.done), String(row.status));
        }
    }
}

test('a phase plan lists Foundation, Growth, and Scale and drops anything a client should not see', () => {
    const roadmap = projectClientRoadmap({
        board: 'phases',
        today: TODAY,
        tasks: [
            task({
                id: 'fix',
                title: `Fix the sitemap for ${EMAIL}`,
                stage: 'foundation',
                status: 'done',
                position: 1,
                completedAt: '2026-11-02T20:00:00.000Z',
                description: 'Make the sitemap so Google can read every page.',
            }),
            task({
                id: 'child',
                title: SUBTASK,
                stage: 'foundation',
                parentTaskId: 'fix',
                position: 2,
                description: `Ask ${EMAIL} about the ${HOURS} hours`,
            }),
            task({
                id: 'pages',
                title: 'Write the service page',
                stage: 'growth',
                status: 'in_progress',
                position: 1,
                description: `Email ${EMAIL} about the 4 hours`,
            }),
            task({
                id: 'more',
                title: 'Add another city page',
                stage: 'scale',
                status: 'review',
                position: 1,
                description: '   ',
            }),
            task({
                id: 'archived',
                title: 'Archived secret task',
                stage: 'growth',
                excluded: true,
            }),
            task({
                id: 'stray',
                title: 'Old month row',
                stage: 'month_1',
                position: 9,
                description: 'Keep this under Foundation.',
            }),
        ],
    });

    assert.deepEqual(roadmap.stages.map(stage => stage.id), ['foundation', 'growth', 'scale']);
    assert.equal(roadmap.stages[0]?.title, 'Foundation');
    assert.equal(roadmap.stages[0]?.description, PHASE_STAGE_COPY.foundation.description);
    assert.equal(roadmap.stages[1]?.description, PHASE_STAGE_COPY.growth.description);
    assert.equal(roadmap.stages[2]?.description, PHASE_STAGE_COPY.scale.description);
    assert.equal(roadmap.stages[0]?.progress, '1 of 2 done');
    assert.equal(roadmap.stages[0]?.done, 1);
    assert.equal(roadmap.stages[0]?.total, 2);
    assert.deepEqual(roadmap.stages[0]?.tasks.map(row => row.title), ['Fix the sitemap for', 'Old month row']);
    assert.equal(roadmap.stages[0]?.tasks[0]?.status, 'Done');
    assert.equal(roadmap.stages[0]?.tasks[0]?.doneOn, 'Nov 2');
    assert.equal(roadmap.stages[0]?.tasks[0]?.description, 'Make the sitemap so Google can read every page.');
    assert.equal(roadmap.stages[1]?.tasks[0]?.status, 'In progress');
    assert.equal(roadmap.stages[1]?.tasks[0]?.description, undefined);
    assert.equal(roadmap.stages[2]?.tasks[0]?.status, 'In review');
    assertAllowlist(roadmap as unknown as { stages: Array<Record<string, unknown> & { tasks: Array<Record<string, unknown>> }> });

    const serialized = JSON.stringify(roadmap);
    for (const secret of [EMAIL, SUBTASK, HOURS, ASSIGNEE, BLOCKED, NOTE, 'Archived secret', 'estimatedHours', 'assigneeIds', 'blockedReason', 'basecamp', 'parentTaskId', 'https://staff.example']) {
        assert.equal(serialized.includes(secret), false, secret);
    }
});

test('a month plan lists Onboarding, This month, and Backlog', () => {
    const roadmap = projectClientRoadmap({
        board: 'months',
        today: TODAY,
        tasks: [
            task({ id: 'kickoff', title: 'Kickoff call', stage: 'onboarding', status: 'done', completedAt: '2026-11-01T20:00:00.000Z', description: 'Walk through the first month together.' }),
            task({ id: 'crawl', title: 'Crawl the site', stage: 'month_1', dueDate: '2026-11-18', description: 'Check the pages we already know about.' }),
            task({ id: 'later', title: 'City pages', stage: 'backlog', dueDate: null, description: '' }),
            task({ id: 'child', title: SUBTASK, stage: 'backlog', parentTaskId: 'later' }),
        ],
    });
    assert.deepEqual(roadmap.stages.map(stage => stage.title), ['Onboarding', 'This month', 'Backlog']);
    assert.equal(roadmap.stages[0]?.description, ROADMAP_COPY.monthOnboarding);
    assert.equal(roadmap.stages[1]?.description, ROADMAP_COPY.monthThisMonth);
    assert.equal(roadmap.stages[2]?.description, ROADMAP_COPY.monthBacklog);
    assert.deepEqual(roadmap.stages[0]?.tasks.map(row => row.title), ['Kickoff call']);
    assert.deepEqual(roadmap.stages[1]?.tasks.map(row => row.title), ['Crawl the site']);
    assert.deepEqual(roadmap.stages[2]?.tasks.map(row => row.title), ['City pages']);
    assert.equal(JSON.stringify(roadmap).includes(SUBTASK), false);
    assert.equal(roadmap.stages[1]?.progress, '0 of 1 done');
});

test('an empty plan has the three stages and no tasks', () => {
    const roadmap = projectClientRoadmap({ board: 'phases', tasks: [], today: TODAY });
    assert.equal(roadmap.stages.every(stage => stage.total === 0), true);
    assert.deepEqual(roadmap.stages.map(stage => stage.progress), [
        ROADMAP_COPY.nothingHere,
        ROADMAP_COPY.nothingHere,
        ROADMAP_COPY.nothingHere,
    ]);
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

test('block options hide a stage and task descriptions', () => {
    const roadmap = projectClientRoadmap({
        board: 'phases',
        today: TODAY,
        tasks: [
            task({ id: 'a', title: 'Fix titles', stage: 'foundation', description: 'Short titles on the main pages.' }),
            task({ id: 'b', title: 'New page', stage: 'growth', description: 'A page for the service people search for.' }),
        ],
    });
    assert.equal(roadmapHasClientDescriptions(roadmap), true);
    const options = readRoadmapBlockOptions({
        hiddenStages: ['growth', 'nope', 4],
        showTaskDescriptions: false,
        tasks: [{ title: 'should not stick' }],
        email: EMAIL,
    });
    assert.deepEqual(options.hiddenStages, ['growth']);
    assert.equal(options.showTaskDescriptions, false);
    const shown = presentRoadmap(roadmap, { ...options, showTaskDescriptions: false });
    assert.deepEqual(shown.stages.map(stage => stage.id), ['foundation', 'scale']);
    assert.equal(shown.stages[0]?.tasks[0]?.description, undefined);
    const described = presentRoadmap(roadmap, { hiddenStages: [], showTaskDescriptions: true });
    assert.equal(described.stages[0]?.tasks[0]?.description, 'Short titles on the main pages.');
});

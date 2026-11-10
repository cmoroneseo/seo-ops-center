/**
 * Run with: node --import tsx --test lib/reports/roadmap-live.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { StageListTask } from '../seo-plan/stage-list.ts';
import { readApprovedReportRoadmap } from './roadmap-live.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const TODAY = '2026-11-10';
const FROZEN = 'Frozen checklist item';
const LIVE = 'Fix the sitemap';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'done',
        stage: 'foundation',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        completedAt: '2026-11-02T20:00:00.000Z',
        description: 'Make the sitemap so Google can read every page.',
        ...overrides,
    };
}

test('an approved report shows the live plan and ignores the frozen checklist', async () => {
    const calls: string[] = [];
    const snapshot = {
        clientId: OTHER,
        portal: { planSnapshot: { plan: { items: [{ title: FROZEN, email: 'abel@marketingempiregroup.com' }] } } },
    };
    const roadmap = await readApprovedReportRoadmap({
        state: 'approved',
        organizationId: ORG,
        clientId: CLIENT,
        snapshot,
        blockProps: {},
    }, {
        today: TODAY,
        loadTasks: async (organizationId, clientId) => {
            calls.push(`${organizationId}:${clientId}`);
            return [task({ id: 'live', title: LIVE })];
        },
        loadBoard: async () => 'phases',
    });
    assert.deepEqual(calls, [`${ORG}:${CLIENT}`]);
    assert.equal(JSON.stringify(roadmap).includes(LIVE), true);
    assert.equal(JSON.stringify(roadmap).includes(FROZEN), false);
    assert.equal(JSON.stringify(roadmap).includes(OTHER), false);
    assert.equal(JSON.stringify(roadmap).includes('abel@'), false);

    const scheduled = await readApprovedReportRoadmap({
        state: 'scheduled',
        organizationId: ORG,
        clientId: CLIENT,
        snapshot,
        blockProps: {},
    }, {
        today: TODAY,
        loadTasks: async () => [task({ id: 'live', title: 'Scheduled live task' })],
        loadBoard: async () => 'phases',
    });
    assert.equal(JSON.stringify(scheduled).includes('Scheduled live task'), true);
});

test('a draft does not use the approved live read, and a missing client returns nothing', async () => {
    let loaded = 0;
    const draft = await readApprovedReportRoadmap({
        state: 'draft',
        organizationId: ORG,
        clientId: CLIENT,
        snapshot: { portal: { planSnapshot: { plan: { items: [{ title: FROZEN }] } } } },
        blockProps: {},
    }, {
        today: TODAY,
        loadTasks: async () => {
            loaded += 1;
            return [];
        },
        loadBoard: async () => 'phases',
    });
    assert.equal(draft, null);
    assert.equal(loaded, 0);

    const missing = await readApprovedReportRoadmap({
        state: 'sent',
        organizationId: ORG,
        clientId: CLIENT,
        snapshot: null,
        blockProps: {},
    }, {
        today: TODAY,
        loadTasks: async () => null,
        loadBoard: async () => 'months',
    });
    assert.equal(missing, null);
});

test('a missing roadmap block does not load tasks', async () => {
    let loaded = 0;
    const result = await readApprovedReportRoadmap({
        state: 'approved',
        organizationId: ORG,
        clientId: CLIENT,
        snapshot: null,
        blockProps: null,
    }, {
        today: TODAY,
        loadTasks: async () => {
            loaded += 1;
            return [task({ id: 'live', title: LIVE })];
        },
        loadBoard: async () => 'phases',
    });
    assert.equal(result, null);
    assert.equal(loaded, 0);
});

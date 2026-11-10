/**
 * Run with: node --import tsx --test lib/reports/roadmap-server.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { StageListTask } from '../seo-plan/stage-list.ts';
import { readApprovedReportRoadmap } from './roadmap-live.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const TODAY = '2026-11-10';

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
        ...overrides,
    };
}

test('the portal payload drops hidden stages and task descriptions', async () => {
    const roadmap = await readApprovedReportRoadmap({
        state: 'sent',
        organizationId: ORG,
        clientId: CLIENT,
        snapshot: { planSnapshot: { plan: { items: [{ title: 'Frozen checklist item' }] } } },
        blockProps: { hiddenStages: ['growth'], showTaskDescriptions: false },
    }, {
        today: TODAY,
        loadTasks: async () => [
            task({
                id: 'fix',
                title: 'Fix the sitemap',
                stage: 'foundation',
                status: 'done',
                completedAt: '2026-11-02T20:00:00.000Z',
                description: 'Make the sitemap so Google can read every page.',
            }),
            task({
                id: 'page',
                title: 'Write the service page',
                stage: 'growth',
                description: 'A page for the service people search for.',
            }),
        ],
        loadBoard: async () => 'phases',
    });
    const serialized = JSON.stringify(roadmap);
    assert.equal(serialized.includes('Write the service page'), false);
    assert.equal(serialized.includes('A page for the service people search for.'), false);
    assert.equal(serialized.includes('Make the sitemap so Google can read every page.'), false);
    assert.equal(serialized.includes('Frozen checklist item'), false);
    assert.equal(serialized.includes('Fix the sitemap'), true);
    assert.equal(roadmap?.stages.some(stage => stage.id === 'growth'), false);
    assert.equal(roadmap?.stages[0]?.tasks[0]?.description, undefined);
});

test('a report row that cannot be read does not return the full plan', async () => {
    let loaded = 0;
    const missing = await readApprovedReportRoadmap({
        state: 'approved',
        organizationId: ORG,
        clientId: CLIENT,
        snapshot: null,
        blockProps: null,
    }, {
        today: TODAY,
        loadTasks: async () => {
            loaded += 1;
            return [task({ id: 'secret', title: 'Secret full plan' })];
        },
        loadBoard: async () => 'phases',
    });
    assert.equal(missing, null);
    assert.equal(loaded, 0);

    const draft = await readApprovedReportRoadmap({
        state: 'draft',
        organizationId: ORG,
        clientId: CLIENT,
        snapshot: null,
        blockProps: { showTaskDescriptions: true },
    }, {
        today: TODAY,
        loadTasks: async () => {
            loaded += 1;
            return [task({ id: 'secret', title: 'Secret full plan' })];
        },
        loadBoard: async () => 'phases',
    });
    assert.equal(draft, null);
    assert.equal(loaded, 0);
});

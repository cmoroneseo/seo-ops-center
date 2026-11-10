/**
 * Run with: node --import tsx --test lib/reports/roadmap-live.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { StageListTask } from '../seo-plan/stage-list.ts';
import { readSharedReportRoadmap } from './roadmap-live.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const REPORT = '66666666-6666-4666-8666-666666666666';
const TODAY = '2026-11-10';
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

const sharedSections = {
    version: 2,
    blocks: [{ id: 'plan', type: 'marketing_plan', props: { planView: 'step', showTaskDescriptions: true } }],
};

test('a shared report shows the live plan and ignores a frozen checklist', async () => {
    const calls: string[] = [];
    const frozen = { plan: { items: [{ title: 'Frozen checklist item', email: 'abel@marketingempiregroup.com' }] } };
    const roadmap = await readSharedReportRoadmap({
        organizationId: ORG,
        clientId: CLIENT,
        reportId: REPORT,
        sections: sharedSections,
        share: 'ok',
    }, {
        today: TODAY,
        loadTasks: async (organizationId, clientId) => {
            calls.push(`${organizationId}:${clientId}`);
            return [task({ id: 'live', title: LIVE })];
        },
        loadBoard: async () => 'phases',
    });
    assert.deepEqual(calls, [`${ORG}:${CLIENT}`]);
    const serialized = JSON.stringify(roadmap);
    assert.equal(serialized.includes(LIVE), true);
    assert.equal(serialized.includes('Frozen checklist item'), false);
    assert.equal(serialized.includes(OTHER), false);
    assert.equal(serialized.includes('abel@'), false);
    void frozen;
});

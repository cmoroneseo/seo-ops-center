/**
 * Run with: node --import tsx --test lib/reports/roadmap-server.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { StageListTask } from '../seo-plan/stage-list.ts';
import { readSharedReportRoadmap } from './roadmap-live.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const OTHER = '99999999-9999-4999-8999-999999999999';
const REPORT = '66666666-6666-4666-8666-666666666666';
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

function deps(loadTasks: (organizationId: string, clientId: string) => Promise<StageListTask[] | null>) {
    return {
        today: TODAY,
        loadTasks,
        loadBoard: async () => 'phases' as const,
    };
}

const sharedWithPlan = {
    version: 2,
    blocks: [{
        id: 'plan',
        type: 'roadmap',
        props: { hiddenStages: ['growth'], showTaskDescriptions: false },
    }],
};

test('a shared report with no review record renders the roadmap', async () => {
    const calls: string[] = [];
    const roadmap = await readSharedReportRoadmap({
        organizationId: ORG,
        clientId: CLIENT,
        reportId: REPORT,
        sections: sharedWithPlan,
        share: 'ok',
    }, deps(async (organizationId, clientId) => {
        calls.push(`${organizationId}:${clientId}:${REPORT}`);
        return [task({
            id: 'fix',
            title: 'Fix the sitemap',
            status: 'done',
            completedAt: '2026-11-02T20:00:00.000Z',
            description: 'Make the sitemap so Google can read every page.',
        })];
    }));
    assert.deepEqual(calls, [`${ORG}:${CLIENT}:${REPORT}`]);
    assert.equal(JSON.stringify(roadmap).includes('Fix the sitemap'), true);
    assert.equal(roadmap?.stages[0]?.tasks[0]?.description, undefined);
});

test('a block removed from the draft after sharing still uses the shared sections', async () => {
    const draftWithoutBlock = { version: 2, blocks: [{ id: 'note', type: 'text', props: { text: 'Draft only' } }] };
    const roadmap = await readSharedReportRoadmap({
        organizationId: ORG,
        clientId: CLIENT,
        reportId: REPORT,
        sections: sharedWithPlan,
        share: 'ok',
    }, deps(async () => [
        task({ id: 'fix', title: 'Fix the sitemap', stage: 'foundation' }),
        task({ id: 'page', title: 'Write the service page', stage: 'growth', description: 'A page for the service people search for.' }),
    ]));
    const serialized = JSON.stringify({ roadmap, draftWithoutBlock });
    assert.equal(JSON.stringify(roadmap).includes('Write the service page'), false);
    assert.equal(JSON.stringify(roadmap).includes('Fix the sitemap'), true);
    assert.equal(serialized.includes('Draft only'), true);
});

test('the portal payload drops hidden stages and task descriptions', async () => {
    const roadmap = await readSharedReportRoadmap({
        organizationId: ORG,
        clientId: CLIENT,
        reportId: REPORT,
        sections: sharedWithPlan,
        share: 'ok',
    }, deps(async () => [
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
    ]));
    const serialized = JSON.stringify(roadmap);
    assert.equal(serialized.includes('Write the service page'), false);
    assert.equal(serialized.includes('A page for the service people search for.'), false);
    assert.equal(serialized.includes('Make the sitemap so Google can read every page.'), false);
    assert.equal(serialized.includes('Fix the sitemap'), true);
    assert.equal(roadmap?.stages.some(stage => stage.id === 'growth'), false);
});

test('a failed share lookup, a missing share, a missing block, and a failed task read return nothing', async () => {
    let loaded = 0;
    const loadTasks = async () => {
        loaded += 1;
        return [task({ id: 'secret', title: 'Secret full plan' })];
    };
    const base = {
        organizationId: ORG,
        clientId: CLIENT,
        reportId: REPORT,
        sections: sharedWithPlan,
    };
    assert.equal(await readSharedReportRoadmap({ ...base, share: 'error' }, deps(loadTasks)), null);
    assert.equal(await readSharedReportRoadmap({ ...base, share: 'missing' }, deps(loadTasks)), null);
    assert.equal(await readSharedReportRoadmap({
        ...base,
        share: 'ok',
        sections: { version: 2, blocks: [{ id: 'note', type: 'text', props: {} }] },
    }, deps(loadTasks)), null);
    assert.equal(loaded, 0);

    const threw = await readSharedReportRoadmap({ ...base, share: 'ok' }, deps(async () => {
        throw new Error('database unavailable');
    }));
    assert.equal(threw, null);

    const missingClient = await readSharedReportRoadmap({
        ...base,
        share: 'ok',
        clientId: OTHER,
    }, deps(async (_organizationId, clientId) => (clientId === CLIENT ? [task({ id: 'fix', title: 'Fix the sitemap' })] : null)));
    assert.equal(missingClient, null);
});

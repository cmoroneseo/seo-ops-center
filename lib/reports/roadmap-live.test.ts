/**
 * Run with: node --import tsx --test lib/reports/roadmap-live.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateToken, hashToken } from '../approvals/token.ts';
import type { StageListTask } from '../seo-plan/stage-list.ts';
import { readApprovedReportRoadmap, readPublicRoadmap, type PublicReportLink } from './roadmap-live.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const REPORT = '66666666-6666-4666-8666-666666666666';
const TODAY = '2026-11-10';
const NOW = new Date('2026-11-10T18:00:00.000Z');
const FROZEN = 'Frozen checklist item';
const LIVE = 'Fix the sitemap';
const OTHER_TASK = 'Other client secret task';

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

function link(tokenHash: string, patch: Partial<PublicReportLink> = {}): PublicReportLink {
    return {
        tokenHash,
        revokedAt: null,
        expiresAt: null,
        organizationId: ORG,
        clientId: CLIENT,
        reportId: REPORT,
        ...patch,
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
    }, {
        today: TODAY,
        loadTasks: async () => null,
        loadBoard: async () => 'months',
    });
    assert.equal(missing, null);
});

test('a public token shows the live plan for its own client, with the saved stage options', async () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const calls: string[] = [];
    const result = await readPublicRoadmap(token, {
        now: () => NOW,
        today: TODAY,
        findLink: async hash => {
            assert.equal(hash, tokenHash);
            assert.notEqual(hash, token);
            return link(tokenHash);
        },
        loadTasks: async (organizationId, clientId) => {
            calls.push(`tasks:${organizationId}:${clientId}`);
            assert.notEqual(clientId, OTHER);
            return [
                task({ id: 'live', title: LIVE, stage: 'foundation' }),
                task({ id: 'grow', title: 'New service page', stage: 'growth', status: 'todo', completedAt: null, description: 'A page for the service people search for.' }),
            ];
        },
        loadBoard: async (organizationId, clientId) => {
            calls.push(`board:${organizationId}:${clientId}`);
            return 'phases';
        },
        loadBlockProps: async (organizationId, clientId, reportId) => {
            calls.push(`props:${organizationId}:${clientId}:${reportId}`);
            return { hiddenStages: ['growth'], showTaskDescriptions: false, tasks: [{ title: OTHER_TASK }] };
        },
    });
    assert.equal(result.ok, true);
    if (!result.ok || !result.roadmap) {
        assert.fail('expected a live roadmap');
        return;
    }
    assert.deepEqual(calls, [
        `props:${ORG}:${CLIENT}:${REPORT}`,
        `tasks:${ORG}:${CLIENT}`,
        `board:${ORG}:${CLIENT}`,
    ]);
    assert.deepEqual(result.roadmap.stages.map(stage => stage.id), ['foundation', 'scale']);
    assert.equal(JSON.stringify(result.roadmap).includes(LIVE), true);
    assert.equal(JSON.stringify(result.roadmap).includes('New service page'), false);
    assert.equal(JSON.stringify(result.roadmap).includes(OTHER_TASK), false);
    assert.equal(result.roadmap?.stages[0]?.tasks[0]?.description, undefined);

    let tasksLoaded = 0;
    const absent = await readPublicRoadmap(token, {
        now: () => NOW,
        today: TODAY,
        findLink: async () => link(tokenHash),
        loadTasks: async () => {
            tasksLoaded += 1;
            return [task({ id: 'live', title: OTHER_TASK })];
        },
        loadBoard: async () => 'phases',
        loadBlockProps: async () => null,
    });
    assert.deepEqual(absent, { ok: true, roadmap: null });
    assert.equal(tasksLoaded, 0);
});

test('a wrong, revoked, or expired token loads no tasks, and a cross-client id is never requested', async () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    let loaded = 0;
    const refuse = async () => {
        loaded += 1;
        return [] as StageListTask[];
    };
    const deps = {
        now: () => NOW,
        today: TODAY,
        loadTasks: async (organizationId: string, clientId: string) => {
            loaded += 1;
            assert.equal(organizationId, ORG);
            assert.equal(clientId, CLIENT);
            assert.notEqual(clientId, OTHER);
            return [task({ id: 'live', title: LIVE })];
        },
        loadBoard: async () => 'phases' as const,
        loadBlockProps: async () => ({}),
    };

    const missing = await readPublicRoadmap(token, { ...deps, findLink: async () => null, loadTasks: refuse });
    assert.deepEqual(missing, { ok: false, denial: 'not_found' });

    const mismatch = await readPublicRoadmap(token, {
        ...deps,
        findLink: async () => link(hashToken('different-token-value-with-enough-length')),
        loadTasks: refuse,
    });
    assert.deepEqual(mismatch, { ok: false, denial: 'not_found' });

    const revoked = await readPublicRoadmap(token, {
        ...deps,
        findLink: async () => link(tokenHash, { revokedAt: '2026-11-01T00:00:00.000Z', expiresAt: '2026-11-02T00:00:00.000Z' }),
        loadTasks: refuse,
    });
    assert.deepEqual(revoked, { ok: false, denial: 'revoked' });

    const expired = await readPublicRoadmap(token, {
        ...deps,
        findLink: async () => link(tokenHash, { expiresAt: '2026-11-09T00:00:00.000Z' }),
        loadTasks: refuse,
    });
    assert.deepEqual(expired, { ok: false, denial: 'expired' });
    assert.equal(loaded, 0);

    const foreign = await readPublicRoadmap('not-the-token', {
        ...deps,
        findLink: async () => link(tokenHash, { clientId: OTHER }),
    });
    assert.equal(foreign.ok, false);
    assert.equal(loaded, 0);
});

/**
 * Run with: node --import tsx --test lib/reports/roadmap-public.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { StageListTask } from '../seo-plan/stage-list.ts';
import { buildGtmEventsReport, type BuildGtmEventsInput } from './gtm-events.ts';
import { decidePublicShare, newPublicToken, type PublicShareRow } from './gtm-share.ts';
import { readPublicRoadmap, type RoadmapShareSources } from './roadmap-public.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const REPORT = '66666666-6666-4666-8666-666666666666';
const OTHER = '99999999-9999-4999-8999-999999999999';
const ASSIGNEE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TODAY = '2026-11-10';
const NOW = new Date('2026-11-10T00:00:00.000Z');
const DESCRIPTION = 'Rewrite the service page so people can find it.';
const HIDDEN_TITLE = 'Write the city page';
const SUBTASK = 'Check the image tags on the homepage';
const ORPHAN = 'Orphan subtask that stays internal';
const PARENT = 'Fix the sitemap';
const STAFF_NOTE = 'Internal note about Abel Miranda';

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

function eventsSnapshot() {
    const input: BuildGtmEventsInput = {
        clientName: 'Kentina Hospitality',
        reportMonth: '2026-10',
        capturedAt: '2026-11-09T18:00:00.000Z',
        sessions: { current: 4, prior: 2 },
        events: { current: [{ eventName: 'page_view', count: 4 }], prior: [{ eventName: 'page_view', count: 1 }] },
        links: { current: [], prior: [] },
        daily: [],
        excludedLinkTexts: [],
        tagSource: 'unavailable',
        tags: [],
        fallbackEventNames: [],
        outboundEventName: 'property_outbound_click',
        bookingEventName: 'booking_click',
        ticketEventName: 'buy_tickets_click',
    };
    return buildGtmEventsReport(input);
}

function roadmapSections(hiddenStages: string[]) {
    return {
        portal: {
            sections: {
                version: 2,
                blocks: [
                    {
                        id: 'plan',
                        type: 'roadmap',
                        props: {
                            hiddenStages,
                            showTaskDescriptions: true,
                            staffNote: STAFF_NOTE,
                            tasks: [{ title: 'Stored task that must not ship', description: DESCRIPTION, assignee: 'Abel Miranda', hours: 17.5 }],
                        },
                    },
                    { id: 'note', type: 'text', props: { text: 'Draft only secret sentence' } },
                ],
            },
        },
    };
}

function liveTasks(): StageListTask[] {
    return [
        task({
            id: 'parent',
            title: PARENT,
            status: 'done',
            completedAt: '2026-11-02T20:00:00.000Z',
            description: DESCRIPTION,
            estimatedHours: 17.5,
            assigneeIds: [ASSIGNEE],
            blockedReason: 'Waiting on Abel Miranda',
        }),
        task({
            id: 'child',
            title: SUBTASK,
            parentTaskId: 'parent',
            description: 'Subtask note that stays internal',
            estimatedHours: 3,
            assigneeIds: [ASSIGNEE],
        }),
        task({
            id: 'orphan',
            title: ORPHAN,
            parentTaskId: 'missing-parent',
            estimatedHours: 17.5,
            assigneeIds: [ASSIGNEE],
        }),
        task({
            id: 'city',
            title: HIDDEN_TITLE,
            stage: 'growth',
            description: DESCRIPTION,
            estimatedHours: 17.5,
            assigneeIds: [ASSIGNEE],
        }),
    ];
}

function openRow(tokenHash: string, overrides: Partial<PublicShareRow> = {}): PublicShareRow {
    return {
        tokenHash,
        kind: 'roadmap',
        revokedAt: null,
        expiresAt: null,
        snapshot: null,
        organizationId: ORG,
        clientId: CLIENT,
        reportId: REPORT,
        ...overrides,
    };
}

test('an events link is refused on the roadmap page and a roadmap link is refused on the events page', async () => {
    const events = newPublicToken();
    const roadmap = newPublicToken();
    const eventsRow = openRow(events.tokenHash, { kind: 'events', snapshot: eventsSnapshot() });
    const roadmapRow = openRow(roadmap.tokenHash, { snapshot: eventsSnapshot() });

    assert.deepEqual(decidePublicShare(eventsRow, events.token, NOW, 'roadmap'), { ok: false, denial: 'not_found' });
    assert.deepEqual(decidePublicShare(roadmapRow, roadmap.token, NOW, 'events'), { ok: false, denial: 'not_found' });
    assert.deepEqual(
        decidePublicShare({ ...roadmapRow, revokedAt: '2026-11-01T00:00:00.000Z' }, roadmap.token, NOW, 'events'),
        { ok: false, denial: 'not_found' },
    );

    const opened = decidePublicShare(openRow(roadmap.tokenHash), roadmap.token, NOW, 'roadmap');
    assert.equal(opened.ok, true);
    if (!opened.ok || opened.kind !== 'roadmap') return;
    assert.equal('snapshot' in opened, false);
    assert.deepEqual(
        [opened.organizationId, opened.clientId, opened.reportId],
        [ORG, CLIENT, REPORT],
    );
    assert.equal(JSON.stringify(opened).includes('Kentina'), false);

    const calls = { sources: 0, tasks: 0 };
    const rejected = await readPublicRoadmap(events.token, deps(eventsRow, { calls }));
    assert.deepEqual(rejected, { ok: false, denial: 'not_found' });
    assert.equal(calls.sources, 0);
    assert.equal(calls.tasks, 0);
});

test('a roadmap link is refused when it is revoked, expired, or the wrong token', async () => {
    const { token, tokenHash } = newPublicToken();
    const revokedCalls = { sources: 0, tasks: 0 };
    const revoked = await readPublicRoadmap(token, deps(openRow(tokenHash, {
        revokedAt: '2026-11-01T00:00:00.000Z',
        expiresAt: '2026-11-02T00:00:00.000Z',
    }), { calls: revokedCalls }));
    assert.deepEqual(revoked, { ok: false, denial: 'revoked' });
    assert.equal(revokedCalls.sources, 0);

    const expiredCalls = { sources: 0, tasks: 0 };
    const expired = await readPublicRoadmap(token, deps(openRow(tokenHash, {
        expiresAt: '2026-11-09T00:00:00.000Z',
    }), { calls: expiredCalls }));
    assert.deepEqual(expired, { ok: false, denial: 'expired' });
    assert.equal(expiredCalls.sources, 0);

    const wrongCalls = { sources: 0, tasks: 0 };
    const wrong = await readPublicRoadmap('not-the-token', deps(openRow(tokenHash), { calls: wrongCalls }));
    assert.deepEqual(wrong, { ok: false, denial: 'not_found' });
    assert.equal(wrongCalls.sources, 0);

    const missing = await readPublicRoadmap(token, deps(null, { calls: { sources: 0, tasks: 0 } }));
    assert.deepEqual(missing, { ok: false, denial: 'not_found' });

    const noIds = await readPublicRoadmap(token, deps(openRow(tokenHash, {
        organizationId: null,
        clientId: null,
        reportId: null,
    }), { calls: { sources: 0, tasks: 0 } }));
    assert.deepEqual(noIds, { ok: false, denial: 'not_found' });
});

test('the public plan drops descriptions, hidden stages, subtasks, hours, and assignees', async () => {
    const { token, tokenHash } = newPublicToken();
    const seen: string[] = [];
    const result = await readPublicRoadmap(token, deps(openRow(tokenHash), {
        sources: {
            share: { sections: { blocks: [{ type: 'roadmap', props: { hiddenStages: [], showTaskDescriptions: true } }] } },
            frozen: { snapshot: roadmapSections(['growth']), versionId: 'version-1' },
        },
        onTasks: (organizationId, clientId) => {
            seen.push(`${organizationId}:${clientId}`);
            if (organizationId !== ORG || clientId !== CLIENT) {
                return [task({ id: 'other', title: 'Other client secret plan' })];
            }
            return liveTasks();
        },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(seen, [`${ORG}:${CLIENT}`]);

    const serialized = JSON.stringify(result.roadmap);
    assert.equal(serialized.includes(PARENT), true);
    assert.equal(result.roadmap.stages.find(stage => stage.id === 'foundation')?.tasks[0]?.doneOn, 'Nov 2');
    assert.equal(result.roadmap.stages.some(stage => stage.id === 'foundation'), true);
    assert.equal(result.roadmap.stages.some(stage => stage.id === 'growth'), false);
    assert.equal(serialized.includes(DESCRIPTION), false);
    assert.equal(serialized.includes(HIDDEN_TITLE), false);
    assert.equal(serialized.includes(SUBTASK), false);
    assert.equal(serialized.includes(ORPHAN), false);
    assert.equal(serialized.includes('17.5'), false);
    assert.equal(serialized.includes(ASSIGNEE), false);
    assert.equal(serialized.includes('Abel'), false);
    assert.equal(serialized.includes(STAFF_NOTE), false);
    assert.equal(serialized.includes('Draft only secret sentence'), false);
    assert.equal(serialized.includes('Stored task that must not ship'), false);
    assert.equal(serialized.includes(OTHER), false);
    assert.equal(serialized.includes('Other client secret plan'), false);
    assert.equal(serialized.includes('Kentina'), false);
    for (const stage of result.roadmap.stages) {
        for (const item of stage.tasks) {
            const keys = Object.keys(item).sort();
            assert.deepEqual(keys, item.doneOn ? ['doneOn', 'status', 'title'] : ['status', 'title']);
            assert.equal('description' in item, false);
        }
    }
});

test('a missing report, a missing roadmap block, and a database error return nothing', async () => {
    const { token, tokenHash } = newPublicToken();
    const row = openRow(tokenHash);
    const secret = [task({ id: 'secret', title: 'Secret full plan', description: DESCRIPTION, estimatedHours: 17.5 })];

    const cases: Array<{ name: string; sources: RoadmapShareSources | null | 'throw'; tasks?: 'null' | 'throw' }> = [
        { name: 'sources missing', sources: null },
        { name: 'sources throw', sources: 'throw' },
        { name: 'share error', sources: { share: 'error', frozen: { snapshot: roadmapSections([]), versionId: 'v' } } },
        { name: 'frozen error', sources: { share: 'missing', frozen: 'error' } },
        { name: 'no block on the latest freeze', sources: {
            share: roadmapSections(['growth']),
            frozen: { snapshot: { portal: { sections: { blocks: [{ type: 'text', props: { text: 'Draft only secret sentence' } }] } } }, versionId: 'v' },
        } },
        { name: 'nothing approved or shared', sources: { share: 'missing', frozen: 'missing' } },
        { name: 'tasks missing', sources: { share: 'missing', frozen: { snapshot: roadmapSections([]), versionId: 'v' } }, tasks: 'null' },
        { name: 'tasks throw', sources: { share: 'missing', frozen: { snapshot: roadmapSections([]), versionId: 'v' } }, tasks: 'throw' },
    ];

    for (const item of cases) {
        let loaded = 0;
        const result = await readPublicRoadmap(token, deps(row, {
            sources: item.sources === 'throw' ? null : item.sources,
            throwSources: item.sources === 'throw',
            onTasks: async () => {
                loaded += 1;
                if (item.tasks === 'throw') throw new Error('database unavailable');
                if (item.tasks === 'null') return null;
                return secret;
            },
        }));
        assert.deepEqual(result, { ok: false, denial: 'not_found' }, item.name);
        assert.equal(JSON.stringify(result).includes('Secret full plan'), false, item.name);
        if (item.tasks == null) assert.equal(loaded, 0, item.name);
    }
});

test('a shared report with no approved version uses the shared options, not the draft', async () => {
    const { token, tokenHash } = newPublicToken();
    const draft = roadmapSections([]);
    const result = await readPublicRoadmap(token, deps(openRow(tokenHash), {
        sources: {
            share: {
                sections: {
                    blocks: [{ type: 'marketing_plan', props: { hiddenStages: ['foundation'], showTaskDescriptions: true } }],
                },
            },
            frozen: 'missing',
        },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.roadmap);
    assert.equal(serialized.includes(PARENT), false);
    assert.equal(serialized.includes(HIDDEN_TITLE), true);
    assert.equal(serialized.includes(DESCRIPTION), false);
    assert.equal(JSON.stringify(draft).includes(DESCRIPTION), true);
});

function deps(row: PublicShareRow | null, options: {
    calls?: { sources: number; tasks: number };
    sources?: RoadmapShareSources | null;
    throwSources?: boolean;
    onTasks?: (organizationId: string, clientId: string) => Promise<StageListTask[] | null> | StageListTask[] | null;
} = {}) {
    const sources = options.sources === undefined
        ? { share: 'missing' as const, frozen: { snapshot: roadmapSections(['growth']), versionId: 'version-1' } }
        : options.sources;
    const calls = options.calls;
    return {
        now: () => NOW,
        today: TODAY,
        findByHash: async (hash: string) => {
            assert.match(hash, /^[a-f0-9]{64}$/);
            if (!row || hash !== row.tokenHash) return null;
            return row;
        },
        loadSources: async (scope: { organizationId: string; clientId: string; reportId: string }) => {
            if (calls) calls.sources += 1;
            if (options.throwSources) throw new Error('database unavailable');
            assert.deepEqual(scope, { organizationId: ORG, clientId: CLIENT, reportId: REPORT });
            return sources;
        },
        loadTasks: async (organizationId: string, clientId: string) => {
            if (calls) calls.tasks += 1;
            if (options.onTasks) return options.onTasks(organizationId, clientId);
            if (organizationId !== ORG || clientId !== CLIENT) return null;
            return liveTasks();
        },
        loadBoard: async () => 'phases' as const,
    };
}

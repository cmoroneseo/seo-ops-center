import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClientAgreement } from './types.ts';
import {
    AGREEMENT_NOT_RECORDED, buildTimeline, commitmentChoices, displayPhase, phaseAnchor, phaseAt, phaseWrite, slipLabel, thisMonthBoard,
    type PhaseWork,
} from './phase.ts';

function agreement(partial: Partial<ClientAgreement> & Pick<ClientAgreement, 'id' | 'startsOn'>): ClientAgreement {
    return {
        organizationId: 'org', clientId: 'client', previousId: null, kind: 'initial', title: partial.id,
        endsOn: null, mode: 'monthly', hours: 10, hoursMode: 'committed', proration: 'daily', timezone: 'America/Los_Angeles',
        scope: 'SEO', services: [], evidence: null, note: null, recordedAt: partial.startsOn, recordedBy: 'user', planSnapshot: null,
        ...partial,
    };
}

const anchor = '2026-10-13';
const initial = agreement({ id: 'root', startsOn: '2026-04-01', endsOn: '2026-09-30' });
const renewal = agreement({ id: 'renewal', kind: 'renewal', previousId: 'root', startsOn: '2026-10-01', title: 'Renewed' });
const superseded = agreement({ id: 'next', kind: 'supersede', previousId: 'root', startsOn: '2026-10-01', title: 'Superseded' });

test('a mid-month anchor keeps that calendar month as Month 1', () => {
    assert.equal(phaseAt(anchor, '2026-10-01'), 'month_1');
    assert.equal(phaseAt(anchor, '2026-10-13'), 'month_1');
    assert.equal(phaseAt(anchor, '2026-10-31'), 'month_1');
    assert.equal(phaseAt(anchor, '2026-11-01'), 'month_2');
    assert.equal(phaseAt(anchor, '2026-09-30'), 'onboarding');
    assert.equal(phaseAt(null, '2026-10-01'), null);
});

test('a renewal and a supersede keep the root agreement clock', () => {
    assert.equal(phaseAnchor([renewal, initial]), '2026-04-01');
    assert.equal(phaseAt(phaseAnchor([renewal, initial]), '2026-10-15'), 'month_7');
    assert.notEqual(phaseAt(phaseAnchor([renewal, initial]), '2026-10-15'), 'month_1');
    assert.equal(phaseAnchor([superseded, initial]), '2026-04-01');
    assert.equal(phaseAt(phaseAnchor([superseded, initial]), '2026-10-15'), 'month_7');
    const cancelled = agreement({ ...initial, cancelledAt: '2026-05-01' });
    assert.equal(phaseAnchor([renewal, cancelled]), '2026-04-01');
});

test('a coverage gap stays Month N and does not report zero hours', () => {
    const opened = agreement({ id: 'a', startsOn: '2026-01-01', endsOn: '2026-03-31' });
    const resumed = agreement({ id: 'b', kind: 'renewal', previousId: 'a', startsOn: '2026-05-01', hours: 8 });
    const model = buildTimeline({
        work: [{
            id: 'item', title: 'April task',
            task: { id: 'april', title: 'April task', status: 'todo', dueDate: '2026-04-15', estimatedHours: 4, agreementId: 'a' },
        }],
        agreements: [opened, resumed], agreementsFailed: false, today: '2026-04-15',
        logs: [{ taskId: 'april', date: '2026-04-15', hours: 2, countsTowardBudget: true }], logsFailed: false,
    });
    const april = model.columns.find(column => column.key === 'month_4');
    assert.equal(april?.title, 'Month 4 · Apr 2026');
    assert.equal(april?.cards[0]?.dueDate, '2026-04-15');
    assert.equal(april?.meta, 'Planned — · Delivered — · outside an agreement');
    assert.equal(april?.meta.includes('0.0h'), false);
    assert.equal(april?.meta.includes('4h'), false);
    assert.equal(april?.agreementLabel, 'In the agreement —');
});

test('an open slipped task rolls forward and a completed task stays on its due phase', () => {
    const start = agreement({ id: 'root', startsOn: '2026-10-01' });
    const work: PhaseWork[] = [{
        id: 'item', title: 'Rank tracking', owner: 'Mei',
        task: { id: 'rank', title: 'Rank tracking', status: 'todo', dueDate: '2026-10-18', estimatedHours: 6 },
    }, {
        id: 'done-item', title: 'Finished audit',
        task: { id: 'audit', title: 'Finished audit', status: 'done', dueDate: '2026-10-12', estimatedHours: 2 },
    }];
    const anchorStart = phaseAnchor([start]);
    const slipped = displayPhase({ anchor: anchorStart, today: '2026-11-15', dueDate: '2026-10-18', status: 'todo' });
    assert.equal(slipped.column, 'month_2');
    assert.equal(slipped.slipLabel, 'Slipped · was Month 1');
    assert.equal(slipped.dueDate, '2026-10-18');
    assert.equal(slipLabel('onboarding'), 'Slipped · was Onboarding');
    const done = displayPhase({ anchor: anchorStart, today: '2026-11-15', dueDate: '2026-10-12', status: 'approved' });
    assert.equal(done.column, 'month_1');
    assert.equal(done.slipped, false);
    const november = thisMonthBoard(work, { anchor: anchorStart, today: '2026-11-15', month: '2026-11' });
    assert.deepEqual(november.slipped, [{ id: 'rank', slipLabel: 'Slipped · was Month 1' }]);
    assert.deepEqual(november.due, []);
    const october = thisMonthBoard(work, { anchor: anchorStart, today: '2026-11-15', month: '2026-10' });
    assert.deepEqual(october.slipped, []);
    assert.deepEqual(october.due, ['audit']);
    const model = buildTimeline({
        work, agreements: [start], agreementsFailed: false, today: '2026-11-15',
        logs: [], logsFailed: false,
    });
    const current = model.columns.find(column => column.key === 'month_2');
    const previous = model.columns.find(column => column.key === 'month_1');
    assert.equal(current?.cards.some(card => card.id === 'rank' && card.slipLabel === 'Slipped · was Month 1' && card.dueDate === '2026-10-18'), true);
    assert.equal(previous?.cards.some(card => card.id === 'audit' && card.slipped === false), true);
    assert.equal(previous?.cards.some(card => card.id === 'rank'), false);
});

test('a locked Onboarding pin stays in Onboarding after the agreement starts', () => {
    const start = agreement({ id: 'root', startsOn: '2026-10-01' });
    const placement = displayPhase({
        anchor: phaseAnchor([start]), today: '2026-11-15', dueDate: '2026-11-20', status: 'todo',
        planPhase: 'onboarding', locked: true,
    });
    assert.equal(placement.column, 'onboarding');
    assert.equal(placement.slipped, false);
    assert.deepEqual(phaseWrite('2026-10-13', '2026-11-02', null), { planPhase: 'month_2', planPhaseLocked: false });
    assert.deepEqual(phaseWrite('2026-10-13', '2026-11-02', 'onboarding'), { planPhase: 'onboarding', planPhaseLocked: true });
    assert.deepEqual(phaseWrite('2026-10-13', '2026-11-02', 'month_2'), { planPhase: 'month_2', planPhaseLocked: false });
    assert.deepEqual(phaseWrite(null, '2026-11-02', null), { planPhase: null, planPhaseLocked: false });
});

test('no agreement uses calendar months and an em dash, never a fake Month 1 or zero', () => {
    const model = buildTimeline({
        work: [{
            id: 'item', title: 'Connect GA4', onboardingChecklist: false,
            task: { id: 'ga4', title: 'Connect GA4', status: 'todo', dueDate: '2026-10-28', estimatedHours: 3 },
        }],
        agreements: [], agreementsFailed: false, today: '2026-10-08',
        logs: [{ taskId: 'ga4', date: '2026-10-20', hours: 1, countsTowardBudget: true }], logsFailed: false,
    });
    assert.equal(model.notice, AGREEMENT_NOT_RECORDED);
    assert.equal(model.columns.some(column => column.title.startsWith('Month ')), false);
    const october = model.columns.find(column => column.key === '2026-10');
    assert.equal(october?.title, 'Oct 2026');
    assert.equal(october?.meta, 'Planned — · Delivered —');
    assert.equal(october?.meta.includes('0.0h'), false);
    assert.equal(october?.cards[0]?.dueDate, '2026-10-28');
});

test('planned hours skip missing estimates and delivered distinguishes a failed load from zero', () => {
    const start = agreement({ id: 'root', startsOn: '2026-10-01', hours: 10, services: [
        { sourceId: 'seo', title: 'SEO hours', type: 'Other', quantity: 1, cadence: 'monthly', countsTowardHours: true },
        { sourceId: 'gbp', title: 'Google Business Profile', type: 'GBP', quantity: 1, cadence: 'monthly', countsTowardHours: false },
    ] });
    const work: PhaseWork[] = [
        { id: 'a', title: 'Rank tracking', task: { id: 'rank', title: 'Rank tracking', status: 'todo', dueDate: '2026-10-28', estimatedHours: 6, agreementId: 'root', commitmentId: 'seo' } },
        { id: 'b', title: 'Citations', task: { id: 'citations', title: 'Citations', status: 'todo', dueDate: '2026-10-20', agreementId: 'other', commitmentId: 'gbp' } },
    ];
    const failed = buildTimeline({ work, agreements: [start], agreementsFailed: false, today: '2026-10-08', logs: null, logsFailed: true });
    const october = failed.columns.find(column => column.key === 'month_1');
    assert.equal(october?.meta, 'Planned 6h · 1 needs an estimate · Delivered —');
    assert.equal(october?.agreementLabel, 'In the agreement 10h');
    const gbp = october?.commitments.find(row => row.id === 'gbp');
    const seo = october?.commitments.find(row => row.id === 'seo');
    assert.equal(seo?.plannedLabel, '6h');
    assert.equal(seo?.deliveredLabel, '—');
    assert.equal(seo?.mismatch, false);
    assert.equal(gbp?.plannedLabel, '— · 1 needs an estimate');
    assert.equal(gbp?.mismatch, true);
    assert.equal(october?.commitments.filter(row => row.id === 'gbp').length, 1);
    const empty = buildTimeline({
        work: [], agreements: [start], agreementsFailed: false, today: '2026-10-08',
        logs: [{ taskId: 'rank', date: '2026-10-20', hours: 2, countsTowardBudget: false }], logsFailed: false,
    });
    assert.equal(empty.columns.find(column => column.key === 'month_1')?.meta, 'Planned — · Delivered 0.0h');
    assert.equal(empty.columns.find(column => column.key === 'month_1')?.commitments.find(row => row.id === 'seo')?.deliveredLabel, '—');
    const logged = buildTimeline({
        work: [work[0]], agreements: [start], agreementsFailed: false, today: '2026-10-08',
        logs: [{ taskId: 'rank', date: '2026-10-21', hours: 1.25, countsTowardBudget: true }], logsFailed: false,
    });
    assert.equal(logged.columns.find(column => column.key === 'month_1')?.meta, 'Planned 6h · Delivered 1.3h');
    assert.equal(commitmentChoices([start]).map(choice => choice.id).join(','), 'seo,gbp');
    assert.equal(commitmentChoices([start]).some(choice => !choice.id), false);
});

test('onboarding checklist items without a task stay in Onboarding and other undated work needs a date', () => {
    const start = agreement({ id: 'root', startsOn: '2026-10-01' });
    const model = buildTimeline({
        work: [
            { id: 'cms', title: 'Confirm website and CMS access', onboardingChecklist: true },
            { id: 'loose', title: 'Loose idea', task: { id: 'loose-task', title: 'Loose idea', status: 'todo' } },
        ],
        agreements: [start], agreementsFailed: false, today: '2026-10-08', logs: [], logsFailed: false,
    });
    assert.equal(model.columns.find(column => column.key === 'onboarding')?.cards.some(card => card.title === 'Confirm website and CMS access'), true);
    assert.equal(model.columns.find(column => column.key === 'needs_date')?.meta, '1 task');
    assert.equal(model.columns.find(column => column.key === 'needs_date')?.cards[0]?.dueLabel, 'no date');
    const board = thisMonthBoard(model.columns.length ? [{
        id: 'loose', title: 'Loose idea', task: { id: 'loose-task', title: 'Loose idea', status: 'todo' },
    }] : [], { anchor: '2026-10-01', today: '2026-10-08', month: '2026-10' });
    assert.deepEqual(board.needsDate, ['loose-task']);
});

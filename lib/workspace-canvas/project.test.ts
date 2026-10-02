import test from 'node:test';
import assert from 'node:assert/strict';
import {
    workDescriptionPreview, assigneeLabel, buildDailySeries, availableThrough, formatMonthLabel, isMonthKey, monthBounds,
    performanceWindow, previousEqualWindow, projectWorkspaceCanvas, resolveAssigneeNames, settleLatest, shiftMonth,
    type CanvasApprovalDoc, type CanvasPlanItem, type CanvasTask, type WorkspaceCanvasInput,
} from './project.ts';

const today = '2026-10-15';
const month = '2026-10';

test('assignee IDs resolve to names without exposing IDs when membership is unavailable', () => {
    assert.deepEqual(resolveAssigneeNames(['user-1', 'user-1', 'removed'], [{ id: 'user-1', name: 'Carlos Morones' }]), ['Carlos Morones', 'Unknown assignee']);
    const model = projectWorkspaceCanvas(baseInput({ plan: { ok: true, value: { items: [planItem({ assignees: ['Abel Miranda'] })] } } }));
    assert.equal(model.board.unscheduled[0].assigneeLabel, 'Abel Miranda');
});

function task(patch: Partial<CanvasTask> = {}): CanvasTask {
    return { id: 't1', title: 'Refresh service page', status: 'todo', assignees: ['Priya Shah'], subtasks: [], ...patch };
}
function planItem(patch: Partial<CanvasPlanItem> = {}): CanvasPlanItem {
    return { id: 'p1', title: 'Checklist row', status: 'todo', roadmapIncluded: true, roadmapPhase: 'month_1', ...patch };
}
function baseInput(patch: Partial<WorkspaceCanvasInput> = {}): WorkspaceCanvasInput {
    return {
        month, today, availableThrough: '2026-10-12',
        client: { engagementModel: 'Retainer', status: 'Active', launchDate: '2026-01-01', seoHours: 30 },
        tasks: { ok: true, value: [] },
        plan: { ok: true, value: { items: [] } },
        monthHours: { ok: true, value: 18 },
        campaignHours: { skipped: true },
        deliverables: { ok: true, value: [] },
        approvals: { ok: true, value: [] },
        search: { ok: true, coverage: 'none' },
        ...patch,
    };
}

test('month boundaries shift across the year and keep February lengths', () => {
    assert.equal(isMonthKey('2026-00'), false);
    assert.equal(shiftMonth('2026-01', -1), '2025-12');
    assert.equal(shiftMonth('2026-12', 1), '2027-01');
    assert.equal(monthBounds('2024-02').end, '2024-02-29');
    assert.equal(monthBounds('2026-02').days.length, 28);
    assert.equal(formatMonthLabel('2026-10'), 'October 2026');
    assert.equal(performanceWindow('2026-10', '2026-09-28'), null);
    assert.deepEqual(performanceWindow('2026-09', '2026-09-28'), { start: '2026-09-01', end: '2026-09-28' });
    assert.deepEqual(previousEqualWindow('2026-09-01', '2026-09-28'), { start: '2026-08-04', end: '2026-08-31' });
    assert.equal(availableThrough(new Date('2026-10-01T18:00:00Z')).length, 10);
});

test('stale responses are dropped when a newer request is current', () => {
    assert.equal(settleLatest(1, 2, 'old'), null);
    assert.equal(settleLatest(2, 2, 'new'), 'new');
});

test('missing search days stay null and a zero baseline is not a percent', () => {
    const current = buildDailySeries('2026-10-01', '2026-10-04', [
        { id: 'a', date: '2026-10-01' },
        { id: 'c', date: '2026-10-03' },
        { id: 'd', date: '2026-10-04' },
    ], [
        { dayId: 'a', clicks: 10, impressions: 100 },
        { dayId: 'c', clicks: 0, impressions: 5 },
        { dayId: 'd', clicks: 5, impressions: 40 },
    ]);
    assert.equal(current[1].clicks, null);
    assert.equal(current[1].impressions, null);
    assert.equal(current[2].clicks, 0);
    const previous = current.map((point, index) => ({ ...point, date: `2026-09-0${index + 1}`, clicks: point.clicks == null ? null : 0, impressions: point.impressions == null ? null : 0 }));
    const model = projectWorkspaceCanvas(baseInput({
        search: { ok: true, coverage: 'ready', property: 'sc-domain:example.com', lastSync: '2026-10-13T00:00:00Z', window: { start: '2026-10-01', end: '2026-10-04' }, current, previous },
    }));
    assert.equal(model.performance.clicks?.total, 15);
    assert.equal(model.performance.clicks?.delta.kind, 'insufficient');
    assert.equal(model.performance.showPrevious, false);
    assert.equal(model.performance.points[1].clicks, null);
    assert.equal(model.performance.points[1].previousClicks, null);
    assert.match(model.performance.message, /not zero/);
    assert.equal(model.performance.clicks?.label, 'Organic search clicks');
});

test('thin coverage hides the comparison series and a failed search is not zero', () => {
    const current = buildDailySeries('2026-10-01', '2026-10-04', [{ id: 'a', date: '2026-10-01' }], [{ dayId: 'a', clicks: 8, impressions: 80 }]);
    const previous = buildDailySeries('2026-09-27', '2026-09-30', [
        { id: 'p1', date: '2026-09-27' }, { id: 'p2', date: '2026-09-28' }, { id: 'p3', date: '2026-09-29' }, { id: 'p4', date: '2026-09-30' },
    ], [
        { dayId: 'p1', clicks: 4, impressions: 10 }, { dayId: 'p2', clicks: 4, impressions: 10 },
        { dayId: 'p3', clicks: 4, impressions: 10 }, { dayId: 'p4', clicks: 4, impressions: 10 },
    ]);
    const thin = projectWorkspaceCanvas(baseInput({
        search: { ok: true, coverage: 'ready', property: 'sc-domain:example.com', lastSync: null, window: { start: '2026-10-01', end: '2026-10-04' }, current, previous },
    }));
    assert.equal(thin.performance.showPrevious, false);
    assert.equal(thin.performance.clicks?.delta.kind, 'insufficient');
    assert.equal(thin.performance.points.every(point => point.previousClicks == null), true);
    const failed = projectWorkspaceCanvas(baseInput({ search: { ok: false, message: 'Select a GSC property first' } }));
    assert.equal(failed.performance.state, 'error');
    assert.equal(failed.performance.clicks, undefined);
    assert.match(failed.board.impact.map(entry => entry.title).join(' '), /unavailable/i);
});

test('equal coverage reports a percent and does not treat the change as caused by tasks', () => {
    const current = [{ date: '2026-10-01', clicks: 20, impressions: 100 }, { date: '2026-10-02', clicks: 20, impressions: 100 }];
    const previous = [{ date: '2026-09-29', clicks: 10, impressions: 80 }, { date: '2026-09-30', clicks: 10, impressions: 80 }];
    const model = projectWorkspaceCanvas(baseInput({
        tasks: { ok: true, value: [task({ status: 'done', completedAt: '2026-10-02', dueDate: '2026-10-02' })] },
        search: { ok: true, coverage: 'ready', property: 'sc-domain:example.com', lastSync: null, window: { start: '2026-10-01', end: '2026-10-02' }, current, previous },
    }));
    assert.equal(model.performance.clicks?.delta.kind, 'percent');
    if (model.performance.clicks?.delta.kind === 'percent') assert.equal(model.performance.clicks.delta.percent, 1);
    const search = model.board.impact.find(entry => entry.id === 'search-clicks');
    assert.match(search?.detail ?? '', /not attributed/i);
    assert.equal(model.board.impact.some(entry => /top 3/i.test(entry.title + entry.detail)), false);
});

test('partial period totals cannot manufacture a decline and complete zero baselines remain explicit', () => {
    const previous = Array.from({ length: 4 }, (_, index) => ({ date: `2026-09-${27 + index}`, clicks: 10, impressions: 100 }));
    const search = { ok: true as const, coverage: 'ready' as const, property: 'sc-domain:example.com', lastSync: null, window: { start: '2026-10-01', end: '2026-10-04' }, previous };
    const current = previous.map((point, index) => ({ ...point, date: `2026-10-0${index + 1}`, clicks: index < 2 ? 10 : null, impressions: index < 2 ? 100 : null }));
    const partial = projectWorkspaceCanvas(baseInput({ search: { ...search, current } }));
    assert.equal(partial.performance.clicks?.total, 20);
    assert.equal(partial.performance.clicks?.delta.kind, 'insufficient');
    assert.equal(partial.performance.showPrevious, false);
    const zero = projectWorkspaceCanvas(baseInput({ search: {
        ...search, current: previous.map((point, index) => ({ ...point, date: `2026-10-0${index + 1}` })),
        previous: previous.map(point => ({ ...point, clicks: 0, impressions: 0 })),
    } }));
    assert.equal(zero.performance.clicks?.delta.kind, 'no_baseline');
});

test('hours distinguish error, zero budget, over budget, campaign totals, and custom scope', () => {
    const over = projectWorkspaceCanvas(baseInput({ monthHours: { ok: true, value: 36 } }));
    assert.equal(over.hours.gauge.arc, 1);
    assert.equal(over.hours.gauge.ratio, 1.2);
    assert.equal(over.hours.gauge.over, true);
    assert.equal(over.hours.gauge.logged, 36);
    const failed = projectWorkspaceCanvas(baseInput({ monthHours: { ok: false } }));
    assert.equal(failed.hours.monthLogged, null);
    assert.equal(failed.hours.gauge.mode, 'unavailable');
    assert.match(failed.hours.detail, /not zero/i);
    const none = projectWorkspaceCanvas(baseInput({ client: { engagementModel: 'Retainer', status: 'Active', seoHours: 0 }, monthHours: { ok: true, value: 0 } }));
    assert.equal(none.hours.status, 'No budget');
    assert.equal(none.hours.gauge.mode, 'none');
    const loggedZero = projectWorkspaceCanvas(baseInput({ monthHours: { ok: true, value: 0 } }));
    assert.equal(loggedZero.hours.monthLogged, 0);
    assert.equal(loggedZero.hours.gauge.mode, 'arc');
    const campaign = projectWorkspaceCanvas(baseInput({
        monthHours: { ok: true, value: 4 },
        campaignHours: { ok: true, value: 40 },
        client: { engagementModel: 'Campaign', status: 'Active', seoHours: 10, campaignConfig: { startDate: '2026-01-01', endDate: '2026-06-30', totalHours: 80 } },
    }));
    assert.equal(campaign.hours.kind, 'campaign_total');
    assert.equal(campaign.hours.label, 'Campaign total');
    assert.equal(campaign.hours.gauge.logged, 40);
    assert.equal(campaign.hours.monthLogged, 4);
    assert.match(campaign.hours.detail, /not October 2026/);
    const custom = projectWorkspaceCanvas(baseInput({
        client: { engagementModel: 'Retainer', status: 'Active', seoHours: 30, setupScope: { version: 1, mode: 'custom', hoursMode: 'allowance', contentPieces: 0, gbp: false, gbpUsesSeoHours: false, listings: false, onboardingBudget: 'separate' } },
    }));
    assert.equal(custom.hours.kind, 'custom');
    assert.equal(custom.hours.gauge.mode, 'none');
    assert.match(custom.hours.detail, /not a monthly cap/i);
});

test('lanes dedupe linked tasks, keep carryover, and leave undated work undated', () => {
    const linked = task({ id: 'linked', title: 'Linked audit', dueDate: '2026-10-18', status: 'in_progress' });
    const model = projectWorkspaceCanvas(baseInput({
        tasks: { ok: true, value: [
            linked,
            task({ id: 'old', title: 'Carry me', dueDate: '2026-09-02', status: 'todo' }),
            task({ id: 'future', title: 'November citations', dueDate: '2026-11-05', status: 'todo' }),
            task({ id: 'later', title: 'December content', dueDate: '2026-12-01', status: 'todo' }),
            task({ id: 'none', title: 'Unscheduled backlog', status: 'todo', dueDate: null }),
            task({ id: 'finished', title: 'Done already', dueDate: '2026-10-01', status: 'done' }),
            task({ id: 'approved', title: 'Approved already', dueDate: '2026-09-01', status: 'approved' }),
            task({ id: 'blocked', title: 'Blocked launch', dueDate: '2026-10-20', status: 'blocked' }),
        ] },
        plan: { ok: true, value: { items: [
            planItem({ id: 'dup', taskId: 'linked', linkedTask: linked, title: 'Stale checklist title' }),
            planItem({ id: 'ignored', status: 'ignored', dueDate: '2026-10-03', title: 'Ignored row' }),
            planItem({ id: 'free', title: 'Unlinked checklist', dueDate: '2026-10-21' }),
        ] } },
    }));
    const titles = (cards: { title: string }[]) => cards.map(card => card.title);
    assert.deepEqual(titles(model.board.now), ['Blocked launch', 'Carry me', 'Linked audit', 'Unlinked checklist']);
    assert.equal(model.board.now.filter(card => card.title === 'Linked audit').length, 1);
    assert.equal(model.board.now.find(card => card.title === 'Linked audit')?.title, 'Linked audit');
    assert.equal(model.board.now.find(card => card.title === 'Carry me')?.badges.includes('Carryover'), true);
    assert.deepEqual(titles(model.board.next), ['November citations', 'December content']);
    assert.deepEqual(titles(model.board.unscheduled), ['Unscheduled backlog']);
    assert.equal(model.board.now.some(card => card.title === 'Done already' || card.title === 'Ignored row'), false);
    assert.equal(assigneeLabel(['A', 'B', 'C', 'D']), 'A, B +2');
    assert.equal(assigneeLabel([]), 'No assignee');
});

test('timeline uses real dates only and does not stretch a due date by the estimate', () => {
    const model = projectWorkspaceCanvas(baseInput({
        tasks: { ok: true, value: [
            task({ id: 'point', title: 'Due only', dueDate: '2026-10-20', estimatedHours: 40 }),
            task({ id: 'span', title: 'Has a start', startDate: '2026-10-05', dueDate: '2026-10-09' }),
            task({ id: 'undated', title: 'No date', estimatedHours: 12 }),
            task({ id: 'outside', title: 'Next month', dueDate: '2026-11-02' }),
        ] },
        deliverables: { ok: true, value: [{ id: 'd1', title: 'Blog draft', status: 'In Progress', dueDate: '2026-10-28' }] },
    }));
    const point = model.timeline.bars.find(bar => bar.title === 'Due only');
    assert.equal(point?.point, true);
    assert.equal(point?.startIndex, point?.endIndex);
    const span = model.timeline.bars.find(bar => bar.title === 'Has a start');
    assert.equal(span?.point, false);
    assert.equal(span && span.endIndex > span.startIndex, true);
    assert.equal(model.timeline.bars.some(bar => bar.title === 'No date' || bar.title === 'Next month'), false);
    assert.equal(model.timeline.deadlinesTitle, 'Upcoming deadlines');
    assert.equal(model.timeline.deadlines.some(item => item.title === 'Blog draft'), true);
    assert.equal(model.phases.phases.some(phase => phase.label === 'Foundation' || phase.label === 'Authority'), false);
    assert.equal(model.phases.phases.map(phase => phase.label).join(','), 'Onboarding,Month 1,Month 2,Month 3,Backlog');
});

test('phases count roadmap items without claiming an active stage', () => {
    const model = projectWorkspaceCanvas(baseInput({
        tasks: { ok: true, value: [task({ id: 'done-task', status: 'done', title: 'Finished audit' })] },
        plan: { ok: true, value: { goal: 'Grow booked consultations', items: [
            planItem({ id: 'a', roadmapPhase: 'onboarding', title: 'Access', status: 'done' }),
            planItem({ id: 'b', roadmapPhase: 'month_1', taskId: 'done-task', linkedTask: task({ id: 'done-task', status: 'done', title: 'Finished audit' }) }),
            planItem({ id: 'c', roadmapPhase: 'month_1', title: 'Still open' }),
            planItem({ id: 'hidden', roadmapIncluded: false, roadmapPhase: 'month_1', title: 'Excluded' }),
        ] } },
    }));
    assert.equal(model.phases.state, 'ready');
    assert.equal(model.phases.phases.find(phase => phase.key === 'onboarding')?.done, 1);
    assert.equal(model.phases.phases.find(phase => phase.key === 'month_1')?.total, 2);
    assert.equal(model.phases.phases.find(phase => phase.key === 'month_1')?.done, 1);
    assert.equal(JSON.stringify(model.phases).includes('active'), false);
    assert.match(model.board.impact.find(entry => entry.id === 'plan-goal')?.detail ?? '', /consultations/);
    const missing = projectWorkspaceCanvas(baseInput({ plan: { ok: true, value: null } }));
    assert.equal(missing.phases.state, 'empty');
    const broken = projectWorkspaceCanvas(baseInput({ plan: { ok: false } }));
    assert.equal(broken.phases.state, 'error');
});

test('attention counts documents once, keeps errors off zero, and lists real blocked work', () => {
    const doc = (patch: Partial<CanvasApprovalDoc>): CanvasApprovalDoc => ({
        id: 'doc', batchId: 'batch', batchName: 'October content', batchStatus: 'in_review', sentAt: '2026-10-01T00:00:00Z',
        title: 'Location page', status: 'pending', ...patch,
    });
    const model = projectWorkspaceCanvas(baseInput({
        approvals: { ok: true, value: [
            doc({ id: 'a', title: 'Page A' }),
            doc({ id: 'b', title: 'Page B', status: 'changes_requested' }),
            doc({ id: 'c', title: 'Approved page', status: 'approved' }),
            doc({ id: 'd', title: 'Draft page', batchStatus: 'draft', sentAt: null }),
            doc({ id: 'e', title: 'Archived page', archivedAt: '2026-10-02' }),
            doc({ id: 'f', title: 'Same deliverable', deliverableId: 'overdue-1' }),
        ] },
        deliverables: { ok: true, value: [
            { id: 'overdue-1', title: 'Same deliverable page', status: 'Review', dueDate: '2026-10-01' },
            { id: 'overdue-2', title: 'Late blog', status: 'In Progress', dueDate: '2026-10-10' },
            { id: 'done', title: 'Published blog', status: 'Published', dueDate: '2026-10-01' },
            { id: 'open', title: 'Future blog', status: 'Pending', dueDate: '2026-10-30' },
        ] },
        tasks: { ok: true, value: [task({ id: 'block', title: 'Waiting on client', status: 'blocked', dueDate: '2026-10-12' })] },
    }));
    assert.equal(model.attention.approvalDocuments, 3);
    assert.equal(model.attention.items.filter(item => item.kind === 'approval').length, 3);
    assert.equal(model.attention.items.some(item => item.title === 'Same deliverable page'), false);
    assert.equal(model.attention.items.some(item => item.title === 'Late blog' && item.action === 'deliverables'), true);
    assert.equal(model.attention.items.some(item => item.taskId === 'block' && item.action === 'task'), true);
    assert.equal(model.attention.items.some(item => item.title === 'Published blog' || item.title === 'Draft page'), false);
    const unavailable = projectWorkspaceCanvas(baseInput({ approvals: { ok: false }, deliverables: { ok: false }, tasks: { ok: false } }));
    assert.equal(unavailable.attention.approvalDocuments, null);
    assert.equal(unavailable.attention.items.length, 0);
    assert.equal(unavailable.attention.approvalsUnavailable, true);
    assert.equal(unavailable.board.tasksUnavailable, true);
});


test('imported work previews remove markup, preserve readable entities, and omit executable content', () => {
    assert.equal(workDescriptionPreview('<p dir="auto">Draft &amp; review</p><p>Next&nbsp;step &#8212; SEO</p>'), 'Draft & review Next step — SEO');
    assert.equal(workDescriptionPreview('<script>alert(1)</script><style>body{}</style><p>Safe &lt;b&gt;text&lt;/b&gt;</p>'), 'Safe <b>text</b>');
    assert.equal(workDescriptionPreview('Spend < 3 hours'), 'Spend < 3 hours');
    assert.equal(workDescriptionPreview('<p> </p>'), undefined);
    const model = projectWorkspaceCanvas(baseInput({ tasks: { ok: true, value: [task({ description: '<p>Imported task</p>' })] } }));
    assert.equal(model.board.unscheduled[0].description, 'Imported task');
});

test('attention prioritizes decisions and blocked work, retaining older overdue records separately', () => {
    const model = projectWorkspaceCanvas(baseInput({ today: '2026-10-15',
        approvals: { ok: true, value: [{ id: 'approval', batchId: 'batch', batchName: 'Content', batchStatus: 'in_review', sentAt: '2026-05-01', title: 'Decision needed', status: 'pending' }] },
        tasks: { ok: true, value: [task({ id: 'blocked', title: 'Blocked work', status: 'blocked', dueDate: '2026-05-01' })] },
        deliverables: { ok: true, value: [
            { id: 'old', title: 'Older item', status: 'Pending', dueDate: '2026-05-31' },
            { id: 'recent', title: 'Recent overdue', status: 'Pending', dueDate: '2026-10-14' },
            { id: 'boundary', title: 'Thirty days ago', status: 'Pending', dueDate: '2026-09-15' },
            { id: 'older-boundary', title: 'Thirty-one days ago', status: 'Pending', dueDate: '2026-09-14' },
        ] },
    }));
    assert.deepEqual(model.attention.items.map(item => item.id), ['approval:approval', 'blocked:blocked', 'deliverable:recent', 'deliverable:boundary', 'deliverable:older-boundary', 'deliverable:old']);
    assert.equal(model.attention.items.filter(item => !item.older).length, 4);
    assert.equal(model.attention.items.filter(item => item.older).length, 2);
    assert.equal(model.attention.items.find(item => item.deliverableId === 'old')?.older, true);
    assert.equal(model.attention.items.find(item => item.taskId === 'blocked')?.older, undefined);
    assert.equal(model.attention.items[0].batchId, 'batch');
});

test('unavailable preliminary dates remain gaps while confirmed zero days stay zero',()=>{
 const points=buildDailySeries('2026-10-01','2026-10-02',[
  {id:'settled',date:'2026-10-01',isIncomplete:false},
  {id:'fresh',date:'2026-10-02',isIncomplete:true},
 ],[]);
 assert.equal(points[0].clicks,0); assert.equal(points[1].clicks,null);
 const fresh=buildDailySeries('2026-10-02','2026-10-02',[{id:'fresh',date:'2026-10-02',isIncomplete:true}],[{dayId:'fresh',clicks:2,impressions:20}]);
 assert.equal(fresh[0].clicks,2);assert.equal(fresh[0].isIncomplete,true);
});

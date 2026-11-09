/**
 * Run with: node --import tsx --test lib/campaign-workspace/briefing.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { completedDeliveries, type CampaignInitiative } from './initiatives.ts';
import {
    budgetHoursInRange,
    engagementFromClient,
    hoursWindow,
    inProgressInitiatives,
    roadmapRows,
    scopeBrief,
} from './briefing.ts';

const TODAY = '2026-11-07';

function initiative(patch: Partial<CampaignInitiative> & Pick<CampaignInitiative, 'id' | 'title' | 'state'>): CampaignInitiative {
    return {
        organizationId: 'org',
        clientId: 'harbor',
        purpose: null,
        ownerName: null,
        priority: 2,
        startsOn: null,
        endsOn: null,
        pageUrl: null,
        successMetricLabel: null,
        evidenceUrl: null,
        verifiedOn: null,
        items: [],
        ...patch,
    };
}

test('an empty roadmap stays empty and does not accept tasks', () => {
    assert.deepEqual(roadmapRows([], TODAY), []);
    const source = readFileSync(new URL('./briefing.ts', import.meta.url), 'utf8');
    assert.equal(/from\('tasks'\)|from\('deliverables'\)|campaign_plans|hoursUsed|TaskStatus/.test(source), false);
});

test('Completed & Verified requires an evidence URL and a verification date', () => {
    const verified = initiative({
        id: 'verified',
        title: 'Profile categories',
        state: 'completed_verified',
        evidenceUrl: 'https://harbor.example/proof',
        verifiedOn: '2026-11-01',
    });
    const unproven = initiative({
        id: 'unproven',
        title: 'Unproven cleanup',
        state: 'completed_verified',
    });
    const doneTaskShape = initiative({
        id: 'task-shaped',
        title: 'Write the brief',
        state: 'planned',
    });
    const deliveries = completedDeliveries([verified, unproven, doneTaskShape], TODAY);
    assert.deepEqual(deliveries.map(item => item.id), ['verified']);
    assert.equal(deliveries[0]?.verification, 'fresh');
});

test('in progress is initiative state, not a task status', () => {
    const planned = initiative({
        id: 'planned',
        title: 'Planned page',
        state: 'planned',
        startsOn: '2026-10-01',
    });
    const started = initiative({ id: 'started', title: 'Emergency page', state: 'in_progress' });
    const blocked = initiative({ id: 'blocked', title: 'Crawl access', state: 'blocked' });
    const waiting = initiative({ id: 'waiting', title: 'Draft approval', state: 'awaiting_approval' });
    const held = initiative({ id: 'held', title: 'Paused launch', state: 'on_hold' });
    const fresh = initiative({
        id: 'fresh',
        title: 'Verified page',
        state: 'completed_verified',
        evidenceUrl: 'https://harbor.example/fresh',
        verifiedOn: '2026-11-01',
    });
    const stale = initiative({
        id: 'stale',
        title: 'Old proof',
        state: 'completed_verified',
        evidenceUrl: 'https://harbor.example/old',
        verifiedOn: '2026-08-01',
    });
    const incomplete = initiative({
        id: 'incomplete',
        title: 'Missing proof',
        state: 'completed_verified',
    });
    const taskMarkedDone = initiative({
        id: 'task-done',
        title: 'Task marked done',
        state: 'planned',
    });
    Object.assign(taskMarkedDone, { status: 'done', taskStatus: 'done' });

    const ids = inProgressInitiatives(
        [planned, started, blocked, waiting, held, fresh, stale, incomplete, taskMarkedDone],
        TODAY,
    ).map(item => item.id);
    assert.deepEqual(new Set(ids), new Set(['started', 'blocked', 'waiting', 'held', 'incomplete']));
    assert.equal(ids.includes('planned'), false);
    assert.equal(ids.includes('task-done'), false);
    assert.equal(ids.includes('fresh'), false);
    assert.equal(ids.includes('stale'), false);
});

test('retainer hours come from logged time and an unset promise is not zero', () => {
    const engagement = engagementFromClient({
        engagementModel: 'Retainer',
        retainerConfig: {
            monthlyHours: 10,
            recurringDeliverables: [],
            ...{ hoursUsed: 99 },
        },
    });
    const brief = scopeBrief({
        engagement,
        month: '2026-11',
        loggedHours: 4.5,
        cells: [{
            type: 'Content',
            promised: 2,
            promisedConfigured: true,
            delivered: 1,
        }],
    });
    assert.equal(brief.hours.basis, 'monthly');
    assert.equal(brief.hours.promisedHours, 10);
    assert.equal(brief.hours.usedHours, 4.5);
    assert.match(brief.hours.promisedText, /10 h this month/);
    assert.match(brief.hours.usedText, /4\.5 h logged/);
    assert.equal(JSON.stringify(brief).includes('99'), false);
    assert.equal(brief.content[0]?.promised, 2);
    assert.equal(brief.content[0]?.delivered, 1);
    assert.match(brief.hours.note, /not an SEO result/);

    const unset = scopeBrief({
        engagement: engagementFromClient({
            engagementModel: 'Retainer',
            retainerConfig: { monthlyHours: 0, recurringDeliverables: [] },
        }),
        month: '2026-11',
        loggedHours: 3,
        cells: [],
    });
    assert.equal(unset.hours.promisedHours, null);
    assert.equal(unset.hours.promisedText, 'Not set');
    assert.equal(unset.hours.usedHours, 3);
    assert.equal(unset.contentState, 'not_set');
    assert.equal(unset.hours.promisedText.includes('0'), false);

    const unread = scopeBrief({
        engagement: engagementFromClient({ engagementModel: 'Retainer' }),
        month: '2026-11',
        loggedHours: null,
        cells: null,
    });
    assert.equal(unread.hours.usedHours, null);
    assert.equal(unread.hours.usedText, 'Not measured');
    assert.equal(unread.contentState, 'not_measured');
});

test('a campaign package hour budget is a dated total, and content prefers fulfillment', () => {
    const engagement = engagementFromClient({
        engagementModel: 'Campaign',
        retainerConfig: {
            monthlyHours: 10,
            recurringDeliverables: [{ type: 'Content', count: 8 }],
        },
        campaignConfig: {
            totalHours: 40,
            startDate: '2026-03-02',
            endDate: '2026-12-31',
            monthlyBlogQuota: 2,
            monthlyBacklinkQuota: 1,
            ...{ hoursUsed: 12 },
        },
    });
    assert.equal(engagement.contract, 'campaign_package');
    assert.equal(engagement.monthlyHours, null);
    assert.equal(engagement.totalHours, 40);
    assert.deepEqual(hoursWindow(engagement, '2026-11'), {
        kind: 'range',
        start: '2026-03-02',
        end: '2026-12-31',
    });

    const fromCommitments = scopeBrief({
        engagement,
        month: '2026-11',
        loggedHours: 6,
        cells: [{
            type: 'Content',
            promised: 3,
            promisedConfigured: true,
            delivered: 1,
        }],
    });
    assert.equal(fromCommitments.hours.basis, 'engagement_total');
    assert.equal(fromCommitments.hours.promisedHours, 40);
    assert.equal(fromCommitments.hours.usedHours, 6);
    assert.equal(fromCommitments.hours.promisedText.includes('month'), false);
    assert.match(fromCommitments.hours.periodText, /Mar 2, 2026/);
    assert.match(fromCommitments.hours.periodText, /Dec 31, 2026/);
    assert.match(fromCommitments.hours.note, /not hours per month/);
    assert.equal(fromCommitments.content.find(line => line.type === 'Content')?.promised, 3);
    assert.equal(fromCommitments.content.find(line => line.type === 'Content')?.delivered, 1);
    assert.equal(fromCommitments.content.some(line => line.promised === 2 || line.promised === 8), false);
    assert.equal(JSON.stringify(fromCommitments).includes('remaining'), false);
    assert.equal(JSON.stringify(fromCommitments).includes('12'), false);

    const quotasOnly = scopeBrief({
        engagement,
        month: '2026-11',
        loggedHours: 6,
        cells: [],
    });
    const blog = quotasOnly.content.find(line => line.type === 'Content');
    const links = quotasOnly.content.find(line => line.type === 'Backlink');
    assert.equal(blog?.label, 'Blog posts');
    assert.equal(blog?.promised, 2);
    assert.equal(blog?.delivered, 0);
    assert.equal(links?.promised, 1);
    assert.equal(links?.delivered, 0);
    assert.equal(JSON.stringify(quotasOnly).includes('remaining'), false);

    const unconfigured = scopeBrief({
        engagement,
        month: '2026-11',
        loggedHours: 6,
        cells: [{
            type: 'Content',
            promised: 0,
            promisedConfigured: false,
            delivered: 4,
        }],
    });
    const content = unconfigured.content.find(line => line.type === 'Content');
    assert.equal(content?.promised, 2);
    assert.equal(content?.delivered, 4);
    assert.equal(content?.promisedText, '2');

    const noPromise = scopeBrief({
        engagement: engagementFromClient({
            engagementModel: 'Campaign',
            campaignConfig: { totalHours: 0, startDate: '2026-03-02', endDate: '2026-12-31', monthlyBlogQuota: 0, monthlyBacklinkQuota: 0 },
        }),
        month: '2026-11',
        loggedHours: null,
        cells: [{ type: 'GBP', promised: 0, promisedConfigured: false, delivered: 1 }],
    });
    assert.equal(noPromise.hours.promisedHours, null);
    assert.equal(noPromise.hours.promisedText, 'Not set');
    assert.equal(noPromise.content[0]?.promised, null);
    assert.equal(noPromise.content[0]?.promisedText, 'Not set');
    assert.equal(noPromise.content[0]?.delivered, 1);

    const undated = scopeBrief({
        engagement: engagementFromClient({
            engagementModel: 'Campaign',
            campaignConfig: { totalHours: 40, startDate: '', endDate: '' },
        }),
        month: '2026-11',
        loggedHours: 9,
        cells: null,
    });
    assert.equal(undated.hours.promisedHours, 40);
    assert.equal(undated.hours.usedHours, null);
    assert.equal(undated.hours.usedText, 'Not measured');
    assert.equal(undated.hours.periodText, 'Dates not set');
    assert.equal(hoursWindow(engagementFromClient({
        engagementModel: 'Campaign',
        campaignConfig: { totalHours: 40 },
    }), '2026-11').kind, 'unavailable');
});

test('budget hours in a package range exclude off-budget, internal, and outside dates', () => {
    const hours = budgetHoursInRange([
        { clientId: 'harbor', hours: 2, countsTowardBudget: true, date: '2026-03-02' },
        { clientId: 'harbor', hours: 1.5, countsTowardBudget: true, date: '2026-06-01T18:00:00Z' },
        { clientId: 'harbor', hours: 1, countsTowardBudget: false, date: '2026-04-01' },
        { clientId: 'harbor', hours: 5, countsTowardBudget: true, date: '2027-01-01' },
        { hours: 8, countsTowardBudget: true, date: '2026-05-01' },
        { clientId: 'other', hours: 4, countsTowardBudget: true, date: '2026-05-01' },
    ], 'harbor', '2026-03-02', '2026-12-31');
    assert.equal(hours, 3.5);
});

test('retainer recurring deliverables fill a type the fulfillment promise does not', () => {
    const brief = scopeBrief({
        engagement: engagementFromClient({
            engagementModel: 'Retainer',
            retainerConfig: {
                monthlyHours: null,
                recurringDeliverables: [
                    { type: 'Content', count: 2 },
                    { type: 'Backlink', count: 0 },
                ],
            },
        }),
        month: '2026-11',
        loggedHours: null,
        cells: [{ type: 'Content', promised: 0, promisedConfigured: false, delivered: 1 }],
    });
    assert.equal(brief.hours.promisedText, 'Not set');
    const content = brief.content.find(line => line.type === 'Content');
    assert.equal(content?.promised, 2);
    assert.equal(content?.delivered, 1);
    assert.equal(brief.content.some(line => line.type === 'Backlink'), false);
});

test('scope loading uses budget time logs and does not read stored hours or plans', () => {
    const source = readFileSync(new URL('./scope-load.ts', import.meta.url), 'utf8');
    assert.match(source, /budgetMonth: true/);
    assert.match(source, /throwOnError: true/);
    assert.match(source, /sumBudgetHoursByClient/);
    assert.match(source, /budgetHoursInRange/);
    assert.match(source, /getFulfillmentMatrix/);
    assert.equal(/hoursUsed|campaign_plans|from\('tasks'\)|from\('deliverables'\)/.test(source), false);
});

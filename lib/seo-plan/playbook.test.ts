import assert from 'node:assert/strict';
import test from 'node:test';

import { MARKETING_PLAN_STEPS, MARKETING_PLAN_TEMPLATE_ITEMS } from '../marketing-plan-template.ts';
import type { SessionOrganization } from '../reports/session-org.ts';
import { onboardingChecklist } from './onboarding.ts';
import { DRAWER_WORDING } from './playbook-plain.ts';
import {
    PLAYBOOK_COPY,
    PLAYBOOK_GROUP_TITLES,
    playbookAddCalls,
    playbookAddLabel,
    playbookAddTitles,
    playbookCatalog,
    playbookChoice,
    playbookChoiceId,
    playbookChoices,
    playbookItems,
    playbookMatching,
    playbookMonthDetail,
    playbookOnPlan,
    playbookRowState,
} from './playbook.ts';
import { createStageTasks, type StageAddDependencies } from './stage-add-route.ts';
import type { StageListTask } from './stage-list.ts';
import { STAGE_ADD_MAX_TITLES } from './stage-add-lines.ts';

const JARGON = /\b(SEO|GBP|GA4|GSC|CMS|API|NAP|URL|CTA|FAQ)\b/;

test('the catalog reuses the saved list, the starting checklist, and saved organization tasks', () => {
    const catalog = playbookCatalog([
        { id: 'tpl-1', title: '  Send the monthly report  ', description: 'Mail the report.' },
        { id: ' ', title: 'Blank id' },
        { id: 'tpl-2', title: '   ' },
        { id: 'tpl-1', title: 'Duplicate id' },
    ]);
    const items = playbookItems(catalog);
    const library = items.filter(row => row.id.startsWith('library:'));
    const checklist = items.filter(row => row.id.startsWith('onboarding:'));
    assert.equal(library.length, MARKETING_PLAN_TEMPLATE_ITEMS.length);
    assert.equal(checklist.length, onboardingChecklist({}).length);
    assert.equal(checklist.some(row => row.templateKey === 'local.gbp' || row.templateKey === 'local.listings'), false);
    library.forEach((row, index) => {
        assert.equal(row.templateKey, MARKETING_PLAN_TEMPLATE_ITEMS[index]?.templateKey);
    });
    const wide = playbookItems(playbookCatalog([], { gbp: true, listings: true }));
    assert.equal(wide.some(row => row.id === 'onboarding:local.gbp'), true);
    assert.equal(wide.some(row => row.id === 'onboarding:local.listings'), true);
    assert.equal(items.some(row => row.title === 'Send the monthly report' && row.id === 'saved:tpl-1'), true);
    assert.equal(items.some(row => row.title === 'Blank id' || row.title === 'Duplicate id'), false);
    assert.equal(catalog[0]?.title, PLAYBOOK_COPY.checklist);
    assert.equal(catalog[1]?.title, PLAYBOOK_COPY.library);
    assert.equal(catalog[2]?.title, PLAYBOOK_COPY.saved);
    for (const step of MARKETING_PLAN_STEPS) {
        assert.equal(catalog[1]?.groups.some(group => group.id === step.key && group.title === PLAYBOOK_GROUP_TITLES[step.key]), true);
    }
});

test('search keeps a group only when every word is in a saved task', () => {
    const catalog = playbookCatalog([]);
    const sitemap = playbookMatching(catalog, '  page   list ');
    const titles = playbookItems(sitemap).map(row => row.title);
    assert.equal(titles.includes('Review the crawl rules and the page list'), true);
    assert.equal(titles.some(title => title.toLocaleLowerCase().includes('kickoff')), false);
    assert.equal(playbookItems(playbookMatching(catalog, 'no-such-task-xyz')).length, 0);
    assert.equal(playbookItems(playbookMatching(catalog, '   ')).length, playbookItems(catalog).length);

    const saved = playbookMatching(playbookCatalog([
        { id: 'tpl-9', title: 'Send the monthly report', description: 'Mail the report to the client.' },
    ]), 'monthly report');
    assert.deepEqual(playbookItems(saved).map(row => row.title), ['Send the monthly report']);
});

test('a task already on the plan is marked and left out, including a shared checklist key', () => {
    const catalog = playbookCatalog([{ id: 'tpl-1', title: 'Send the monthly report' }]);
    const items = playbookItems(catalog);
    const kickoff = items.find(row => row.title === 'Hold kickoff call and set expectations');
    const analytics = items.find(row => row.templateKey === 'access.analytics' && row.title === 'Connect Google Analytics');
    const searchConsole = items.find(row => row.templateKey === 'access.analytics' && row.title === 'Connect Google Search Console');
    const combined = items.find(row => row.id === 'onboarding:access.analytics');
    const report = items.find(row => row.id === 'saved:tpl-1');
    assert.ok(kickoff && analytics && searchConsole && combined && report);

    const existing = [{ title: '  hold kickoff call and set expectations ' }];
    assert.equal(playbookOnPlan(kickoff, existing), true);
    assert.equal(playbookRowState(kickoff, existing, []), 'plan');
    assert.deepEqual(playbookAddTitles([kickoff, analytics], existing), [analytics.title]);

    const withAnalytics = [{ title: 'Connect Google Analytics 4' }];
    assert.equal(playbookOnPlan(searchConsole, withAnalytics), true);
    assert.equal(playbookOnPlan(combined, withAnalytics), true);
    assert.equal(playbookRowState(combined, withAnalytics, []), 'plan');

    assert.equal(playbookOnPlan(report, [{ title: 'send the monthly report' }]), true);
    assert.equal(playbookOnPlan(report, [{ title: 'Send the weekly report' }]), false);
    assert.equal(playbookOnPlan(kickoff, [{ title: kickoff.title, status: 'ignored' }]), false);
    assert.equal(playbookOnPlan(kickoff, [{ title: kickoff.title, excluded: true }]), false);
    assert.equal(playbookOnPlan(combined, [{ title: 'connect google analytics 4' }]), true);
});

test('picking the whole saved list keeps distinct titles and drops a repeated one', () => {
    const items = playbookItems(playbookCatalog([]));
    const analytics = items.filter(row => row.templateKey === 'access.analytics');
    assert.equal(analytics.length >= 2, true);
    const titles = playbookAddTitles(analytics, []);
    assert.deepEqual(titles, analytics.map(row => row.title));

    const sameTitle = items.filter(row => row.title === 'Confirm access to the website editor');
    assert.equal(sameTitle.length, 2);
    assert.deepEqual(playbookAddTitles(sameTitle, []), ['Confirm access to the website editor']);
    assert.equal(playbookRowState(sameTitle[1], [], [sameTitle[0]]), 'same');
    assert.equal(playbookRowState(sameTitle[0], [], [sameTitle[0]]), 'chosen');
});

test('the chosen stage is the one the drawer was opened from', () => {
    assert.equal(playbookChoiceId('phases', 'growth'), 'growth');
    assert.equal(playbookChoiceId('phases', 'scale'), 'scale');
    assert.equal(playbookChoiceId('phases', null), 'foundation');
    assert.equal(playbookChoiceId('phases', 'onboarding'), 'foundation');
    assert.equal(playbookChoiceId('months', 'backlog'), 'backlog');
    assert.equal(playbookChoiceId('months', 'onboarding'), 'onboarding');
    assert.equal(playbookChoiceId('months', null), 'this_month');

    const phases = playbookChoices('phases', '2026-10', '2026-10-19');
    assert.deepEqual(phases.map(choice => choice.id), ['foundation', 'growth', 'scale']);
    assert.equal(phases[1]?.stage, 'growth');
    assert.equal(phases[1]?.dueDate, null);

    const months = playbookChoices('months', '2026-10', '2026-10-19');
    assert.deepEqual(months.map(choice => choice.label), ['Onboarding', 'This month', 'Backlog']);
    assert.equal(months[1]?.stage, 'backlog');
    assert.equal(months[1]?.dueDate, '2026-10-31');
    assert.equal(playbookMonthDetail('2026-11', '2026-10-19'), 'Tasks due at the end of November 2026.');
    const november = playbookChoice('months', '2026-11', '2026-10-19', 'this_month');
    assert.equal(november?.label, 'November 2026');
    assert.equal(november?.dueDate, '2026-11-30');
});

test('a long selection is split into batches the existing add path accepts', () => {
    const growth = playbookChoice('phases', '2026-10', '2026-10-19', 'growth');
    assert.ok(growth);
    const titles = Array.from({ length: STAGE_ADD_MAX_TITLES + 1 }, (_, index) => `Task ${index + 1}`);
    const calls = playbookAddCalls(titles, growth);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.titles.length, STAGE_ADD_MAX_TITLES);
    assert.equal(calls[1]?.titles.length, 1);
    assert.equal(calls[0]?.stage, 'growth');
    assert.equal(calls[0]?.dueDate, undefined);
    assert.equal(calls[0]?.items, undefined);

    const month = playbookChoice('months', '2026-10', '2026-10-19', 'this_month');
    assert.ok(month);
    const dated = playbookAddCalls(['Write the service page'], month);
    assert.deepEqual(dated, [{
        stage: 'backlog',
        titles: ['Write the service page'],
        dueDate: '2026-10-31',
        items: [{ title: 'Write the service page', depth: 0 }],
    }]);
    assert.equal(playbookAddLabel(1), 'Add 1 task');
    assert.equal(playbookAddLabel(3), 'Add 3 tasks');
});

test('drawer catalog wording spells out jargon and keeps template keys', () => {
    const shown = playbookItems(playbookCatalog([], { gbp: true, listings: true }))
        .filter(row => row.id.startsWith('library:') || row.id.startsWith('onboarding:'))
        .map(row => `${row.title}\n${row.description}`)
        .join('\n');
    assert.doesNotMatch(shown, /\b(CMS|GA4|GSC|SEO|GBP|NAP|XML|Ahrefs|HTTPS|URL|URLs|FAQ|CTA|CTAs|DR|INP|LCP|CLS|H1|H2|H3|WebP|SERP)\b|robots\.txt|4xx|5xx|\b301/);
    assert.equal(MARKETING_PLAN_TEMPLATE_ITEMS.some(row => row.title === 'Confirm website and CMS access'), true);
    assert.equal(shown.includes('Confirm access to the website editor'), true);
});

test('playbook copy is plain language', () => {
    const written = [
        ...Object.values(PLAYBOOK_COPY),
        ...Object.values(PLAYBOOK_GROUP_TITLES),
        playbookAddLabel(1),
        playbookAddLabel(4),
        playbookMonthDetail('2026-11', '2026-10-19'),
        ...Object.values(DRAWER_WORDING).flatMap(row => [row.title, row.description]),
        ...playbookChoices('phases', '2026-10', '2026-10-19').flatMap(choice => [choice.label, choice.detail]),
        ...playbookChoices('months', '2026-10', '2026-10-19').flatMap(choice => [choice.label, choice.detail]),
    ].join('\n');
    assert.doesNotMatch(written, JARGON);
    assert.match(written, /Add from a playbook/);
    assert.match(written, /Already in the plan/);
    assert.match(written, /Foundation/);
    assert.match(written, /Getting started/);
});

const org = '06e536b9-beac-49bc-8c96-1df021102590';
const other = '11111111-1111-4111-8111-111111111111';
const clientId = '7071eda4-ccc6-4122-abef-4cb0702bc682';

test('added playbook tasks use the session organization and the path client', async () => {
    const rows: Record<string, unknown>[] = [];
    const seen: string[] = [];
    const dependencies: StageAddDependencies = {
        session: async (): Promise<SessionOrganization> => ({
            ok: true,
            userId: 'user-1',
            organizationId: org,
            role: 'member',
        }),
        enabled: () => true,
        now: () => '2026-10-16T17:00:00.000Z',
        loadClient: async (organizationId, id) => {
            seen.push(`${organizationId}:${id}`);
            return true;
        },
        loadParent: async () => null,
        maxPosition: async () => null,
        insertTasks: async inserted => {
            rows.push(...inserted);
            return inserted.map((row, index) => ({
                id: `saved-${index}`,
                title: String(row.title),
                status: 'todo',
                stage: String(row.stage),
                position: typeof row.position === 'number' ? row.position : 1,
                parentTaskId: null,
                createdAt: '2026-10-16T17:00:00.000Z',
                category: null,
                basecamp: false,
                recurring: false,
            } satisfies StageListTask));
        },
    };
    const choice = playbookChoice('phases', '2026-10', '2026-10-19', 'scale');
    assert.ok(choice);
    const [call] = playbookAddCalls(['Write the service page', 'Add the city page'], choice);
    const added = await createStageTasks(clientId, {
        ...call,
        organizationId: other,
        clientId: other,
        createdBy: 'attacker',
    }, dependencies);
    assert.equal(added.status, 200);
    assert.deepEqual(seen, [`${org}:${clientId}`]);
    assert.equal(rows.length, 2);
    assert.equal(rows.every(row => row.organization_id === org && row.client_id === clientId && row.stage === 'scale'), true);
    assert.deepEqual(rows.map(row => row.title), ['Write the service page', 'Add the city page']);
    assert.equal(rows.some(row => row.organization_id === other || row.client_id === other || row.created_by === 'attacker'), false);

    const month = playbookChoice('months', '2026-10', '2026-10-19', 'this_month');
    assert.ok(month);
    const [dated] = playbookAddCalls(['Write the service page'], month);
    const monthRows: Record<string, unknown>[] = [];
    dependencies.insertTasks = async inserted => {
        monthRows.push(...inserted);
        return inserted.map((row, index) => ({
            id: `month-${index}`,
            title: String(row.title),
            status: 'todo',
            stage: String(row.stage),
            position: 1,
            parentTaskId: null,
            createdAt: '2026-10-16T17:00:00.000Z',
            category: null,
            basecamp: false,
            recurring: false,
        } satisfies StageListTask));
    };
    const datedResult = await createStageTasks(clientId, { ...dated, organizationId: other }, dependencies);
    assert.equal(datedResult.status, 200);
    assert.equal(monthRows[0]?.stage, 'backlog');
    assert.equal(monthRows[0]?.due_date, '2026-10-31');
    assert.equal(monthRows[0]?.organization_id, org);
    assert.equal(monthRows[0]?.client_id, clientId);
});

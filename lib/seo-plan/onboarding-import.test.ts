import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardingSeedItems } from './onboarding.ts';
import {
    applyOnboardingPlacements,
    matchOnboardingTitle,
    planOnboardingAdditions,
    summarizeOnboardingAdd,
    type OnboardingItemRef,
    type OnboardingTaskRef,
} from './onboarding-import.ts';

const STEPS = ['setup', 'technical', 'research', 'content', 'onpage', 'links', 'local'];
const ONBOARDING_LIST = '10388242459';

function seededItems(): OnboardingItemRef[] {
    return onboardingSeedItems({}).map((item, index) => ({
        id: `item-${item.templateKey}`,
        title: item.title,
        stepKey: item.stepKey,
        templateKey: item.templateKey,
        taskId: null,
    }));
}

function task(id: string, title: string, todoId: number, sourceTodolistId?: string): OnboardingTaskRef {
    return { id, title, basecampTodoId: todoId, sourceTodolistId: sourceTodolistId ?? null };
}

const floorCo = [
    task('cookies', 'Set Up Empire Cookies', 1),
    task('research', 'Perform keyword research', 2),
    task('benchmark', 'Benchmark current SEO & Website analytics (if possible)', 3),
    task('roadmap', 'Create SEO Roadmap & Recommendations List', 4),
    task('platform', 'Add Project to SEO platform', 5),
    task('rank', 'Add keywords to Position tracking', 6),
    task('analytics', 'Connect Google Analytics and Search Console to website', 7),
    task('portal', 'Connect Search Console and Analytics to Client Portal', 8),
    task('launch', 'Campaign Launch', 9),
];

test('standard Basecamp onboarding titles land on the checklist key or Introduction & Setup', () => {
    assert.equal(matchOnboardingTitle('Set Up Empire Cookies')?.templateKey, 'tracking.consent');
    assert.equal(matchOnboardingTitle('Create SEO Roadmap & Recommendations List')?.templateKey, 'strategy.roadmap');
    assert.equal(matchOnboardingTitle('Add keywords to Position tracking')?.templateKey, 'tracking.rank');
    assert.equal(matchOnboardingTitle('Connect Google Analytics and Search Console to website')?.templateKey, 'access.analytics');
    assert.equal(matchOnboardingTitle('Connect Search Console and Analytics to Client Portal')?.templateKey, 'access.portal');
    assert.equal(matchOnboardingTitle('Perform keyword research'), null);
    assert.equal(matchOnboardingTitle('Add Project to SEO platform'), null);
    assert.equal(matchOnboardingTitle('Campaign Launch'), null);
    assert.equal(matchOnboardingTitle('Benchmark current SEO & Website analytics (if possible)'), null);
    assert.equal(matchOnboardingTitle('Run full site crawl')?.stepKey, 'technical');
    assert.equal(matchOnboardingTitle('Run full site crawl')?.templateKey, null);
});

test('onboarding todos link onto the checklist row and do not twin it', () => {
    const placements = planOnboardingAdditions({
        tasks: floorCo,
        items: seededItems(),
        onboardingTodolistId: ONBOARDING_LIST,
        onboardingTodoIds: floorCo.map(row => row.basecampTodoId!),
        stepKeys: STEPS,
    });
    const byTask = new Map(placements.map(row => [row.taskId, row]));
    assert.equal(byTask.get('cookies')?.action, 'link');
    assert.equal(byTask.get('roadmap')?.action, 'link');
    assert.equal(byTask.get('rank')?.action, 'link');
    assert.equal(byTask.get('analytics')?.action, 'link');
    assert.equal(byTask.get('portal')?.action, 'link');
    for (const id of ['research', 'benchmark', 'platform', 'launch']) {
        const placement = byTask.get(id);
        assert.equal(placement?.action, 'create');
        if (placement?.action === 'create') assert.equal(placement.stepKey, 'setup');
    }
    const linkedItems = placements.flatMap(row => row.action === 'link' ? [row.itemId] : []);
    assert.equal(new Set(linkedItems).size, linkedItems.length);
});

test('a checklist row that already has a task is not given a twin', () => {
    const items = seededItems().map(item => item.templateKey === 'access.analytics'
        ? { ...item, taskId: 'other-task' }
        : item);
    const placements = planOnboardingAdditions({
        tasks: [task('analytics', 'Connect Google Analytics and Search Console to website', 7)],
        items,
        onboardingTodolistId: ONBOARDING_LIST,
        onboardingTodoIds: [7],
        stepKeys: STEPS,
    });
    assert.deepEqual(placements, [{ action: 'skip', taskId: 'analytics', reason: 'covered' }]);
});

test('a second todo for the same checklist key is left alone', () => {
    const placements = planOnboardingAdditions({
        tasks: [
            task('one', 'Connect Google Analytics and Search Console to website', 7),
            task('two', 'Connect Google Analytics and Search Console', 8),
        ],
        items: seededItems(),
        onboardingTodolistId: ONBOARDING_LIST,
        onboardingTodoIds: [7, 8],
        stepKeys: STEPS,
    });
    assert.equal(placements[0].action, 'link');
    assert.deepEqual(placements[1], { action: 'skip', taskId: 'two', reason: 'covered' });
});

test('tasks already on the plan, and tasks from the SEO Plan list, are not added again', () => {
    const items = seededItems().map(item => item.templateKey === 'tracking.consent'
        ? { ...item, taskId: 'cookies' }
        : item);
    const placements = planOnboardingAdditions({
        tasks: [
            task('cookies', 'Set Up Empire Cookies', 1),
            task('seo-work', 'Publish the first blog batch', 50, '999'),
        ],
        items,
        onboardingTodolistId: ONBOARDING_LIST,
        onboardingTodoIds: [1],
        stepKeys: STEPS,
    });
    assert.deepEqual(placements, [{ action: 'skip', taskId: 'cookies', reason: 'already-linked' }]);
});

test('a stamped onboarding import still counts when the live list no longer returns it', () => {
    const placements = planOnboardingAdditions({
        tasks: [task('cookies', 'Set Up Empire Cookies', 1, ONBOARDING_LIST)],
        items: [],
        onboardingTodolistId: ONBOARDING_LIST,
        onboardingTodoIds: [],
        stepKeys: STEPS,
    });
    assert.equal(placements[0].action, 'create');
    if (placements[0].action === 'create') assert.equal(placements[0].stepKey, 'setup');
});

test('an import selection only adds the to-dos that were just brought in', () => {
    const placements = planOnboardingAdditions({
        tasks: floorCo,
        items: [],
        onboardingTodolistId: ONBOARDING_LIST,
        onboardingTodoIds: floorCo.map(row => row.basecampTodoId!),
        stepKeys: STEPS,
        onlyBasecampTodoIds: new Set([1]),
    });
    assert.deepEqual(placements.map(row => row.taskId), ['cookies']);
});

test('apply keeps going when one link fails', async () => {
    const counts = await applyOnboardingPlacements([
        { action: 'link', taskId: 'a', itemId: 'item', stepKey: 'setup' },
        { action: 'create', taskId: 'b', stepKey: 'setup' },
        { action: 'skip', taskId: 'c', reason: 'covered' },
    ], {
        link: async () => { throw new Error('Plan item already has a task'); },
        create: async () => 'new-item',
        setPhase: async () => {},
    });
    assert.deepEqual(counts, { linked: 0, created: 1, skipped: 1, failed: 1 });
    assert.match(summarizeOnboardingAdd(2, counts), /1 added as a new checklist row/);
    assert.match(summarizeOnboardingAdd(0, counts), /Import the onboarding list/);
});

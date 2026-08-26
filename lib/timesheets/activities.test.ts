import test from 'node:test';
import assert from 'node:assert/strict';
import {
    TIMESHEET_ACTIVITIES,
    budgetDefaultFor,
    describeActivity,
    findActivity,
} from './activities.ts';

test('every SEO delivery activity is offered', () => {
    assert.ok(TIMESHEET_ACTIVITIES.length >= 28);
    assert.ok(findActivity('technical_audit'));
    assert.ok(findActivity('blog_post'));
});

test('delivery activities count toward the SEO budget', () => {
    assert.equal(budgetDefaultFor(['technical_audit']), true);
    assert.equal(budgetDefaultFor(['blog_post']), true);
    assert.equal(budgetDefaultFor(['gbp_monthly']), true);
});

test('the budget default is true when ANY selected activity bills', () => {
    // A 4h block tagged both a delivery audit and internal admin still did
    // billable delivery work; the hours were never split apart.
    assert.equal(budgetDefaultFor(['internal_admin', 'technical_audit']), true);
    assert.equal(budgetDefaultFor(['technical_audit', 'internal_admin']), true);
    assert.equal(
        budgetDefaultFor(['gbp_optimization', 'keyword_research', 'content_strategy']),
        true,
    );
    // Only when nothing selected bills does the default fall to false.
    assert.equal(budgetDefaultFor(['internal_admin', 'client_meeting']), false);
    assert.equal(budgetDefaultFor([]), false);
});

test('non-delivery activities exist and do not consume budget', () => {
    for (const key of ['client_meeting', 'internal_admin', 'account_management', 'training']) {
        const activity = findActivity(key);
        assert.ok(activity, `missing non-delivery activity ${key}`);
        assert.equal(activity.countsTowardBudget, false, key);
        assert.equal(budgetDefaultFor([key]), false, key);
    }
});

test('an unknown activity key never silently bills a client', () => {
    assert.equal(findActivity('not_a_real_key'), null);
    assert.equal(budgetDefaultFor(['not_a_real_key']), false);
    assert.equal(budgetDefaultFor(['']), false);
    // An unknown key contributes nothing rather than poisoning the whole set.
    assert.equal(budgetDefaultFor(['not_a_real_key', 'internal_admin']), false);
    assert.equal(budgetDefaultFor(['not_a_real_key', 'technical_audit']), true);
});

test('activity keys are unique', () => {
    const keys = TIMESHEET_ACTIVITIES.map(activity => activity.key);
    assert.equal(new Set(keys).size, keys.length);
});

test('a description is the activity label, optionally refined by detail', () => {
    assert.equal(describeActivity(['technical_audit'], ''), 'Technical SEO Audit');
    assert.equal(
        describeActivity(['technical_audit'], 'Crawl budget on /products'),
        'Technical SEO Audit — Crawl budget on /products',
    );
    assert.equal(describeActivity(['technical_audit'], '   '), 'Technical SEO Audit');
});

test('several activities read in catalog order, not selection order', () => {
    const catalogOrder = TIMESHEET_ACTIVITIES.map(activity => activity.key);
    const picked = ['content_strategy', 'gbp_optimization', 'keyword_research'];
    // Guard the premise: this selection really is out of catalog order.
    const positions = picked.map(key => catalogOrder.indexOf(key));
    assert.notDeepEqual(positions, [...positions].sort((a, b) => a - b));

    const expected = TIMESHEET_ACTIVITIES
        .filter(activity => picked.includes(activity.key))
        .map(activity => activity.label)
        .join(', ');
    assert.equal(describeActivity(picked, ''), expected);
    // Any order of the same set produces the same stored text.
    assert.equal(describeActivity([...picked].reverse(), ''), expected);
    assert.equal(
        describeActivity(picked, 'Aug refresh'),
        `${expected} — Aug refresh`,
    );
});

test('detail alone is used when no activity is known', () => {
    assert.equal(describeActivity([], 'Ad hoc fix'), 'Ad hoc fix');
    assert.equal(describeActivity([], ''), '');
    assert.equal(describeActivity(['not_a_real_key'], 'Ad hoc fix'), 'Ad hoc fix');
});

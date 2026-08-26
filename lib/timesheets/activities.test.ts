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
    assert.equal(budgetDefaultFor('technical_audit'), true);
    assert.equal(budgetDefaultFor('blog_post'), true);
    assert.equal(budgetDefaultFor('gbp_monthly'), true);
});

test('non-delivery activities exist and do not consume budget', () => {
    for (const key of ['client_meeting', 'internal_admin', 'account_management', 'training']) {
        const activity = findActivity(key);
        assert.ok(activity, `missing non-delivery activity ${key}`);
        assert.equal(activity.countsTowardBudget, false, key);
        assert.equal(budgetDefaultFor(key), false, key);
    }
});

test('an unknown activity key never silently bills a client', () => {
    assert.equal(findActivity('not_a_real_key'), null);
    assert.equal(budgetDefaultFor('not_a_real_key'), false);
    assert.equal(budgetDefaultFor(''), false);
});

test('activity keys are unique', () => {
    const keys = TIMESHEET_ACTIVITIES.map(activity => activity.key);
    assert.equal(new Set(keys).size, keys.length);
});

test('a description is the activity label, optionally refined by detail', () => {
    assert.equal(describeActivity('technical_audit', ''), 'Technical SEO Audit');
    assert.equal(
        describeActivity('technical_audit', 'Crawl budget on /products'),
        'Technical SEO Audit — Crawl budget on /products',
    );
    assert.equal(describeActivity('technical_audit', '   '), 'Technical SEO Audit');
});

test('detail alone is used when the key is unknown', () => {
    assert.equal(describeActivity('', 'Ad hoc fix'), 'Ad hoc fix');
    assert.equal(describeActivity('', ''), '');
});

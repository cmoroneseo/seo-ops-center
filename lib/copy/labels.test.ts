import test from 'node:test';
import assert from 'node:assert/strict';
import {
    campaignGoalStatusLabel,
    deliverableTypeLabel,
    portalWorkStatusLabel,
    receiptTagLabel,
    reportStatusLabel,
    TASK_STATUS_LABELS,
    taskStatusLabel,
} from './labels.ts';

test('stored statuses never render as the raw value', () => {
    assert.equal(taskStatusLabel('todo'), 'To Do');
    assert.equal(taskStatusLabel('in_progress'), 'In Progress');
    assert.equal(taskStatusLabel('done'), 'Done');
    assert.equal(reportStatusLabel('draft'), 'Draft');
    assert.equal(reportStatusLabel('published'), 'Published');
    assert.equal(campaignGoalStatusLabel('at_risk'), 'At risk');
    assert.equal(portalWorkStatusLabel('in_review'), 'In review');
    assert.equal(receiptTagLabel('snapshot'), 'Saved');
    assert.equal(receiptTagLabel('prelim'), 'Early');
    assert.equal(deliverableTypeLabel('GBP'), 'Business Profile');
});

test('every mapped label is plain words', () => {
    const labels = [
        ...Object.values(TASK_STATUS_LABELS),
        reportStatusLabel('draft'),
        campaignGoalStatusLabel('at_risk'),
        portalWorkStatusLabel('in_progress'),
        receiptTagLabel('ref'),
        deliverableTypeLabel('Backlink'),
    ];
    for (const label of labels) {
        assert.equal(label.includes('_'), false, label);
        assert.doesNotMatch(label, /\b(GSC|GA4|CTR|GBP|GTM)\b/);
    }
});

test('an unknown status stays visible instead of going blank', () => {
    assert.equal(taskStatusLabel('archived'), 'archived');
    assert.equal(reportStatusLabel('approved'), 'approved');
});

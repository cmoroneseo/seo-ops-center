import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReceiptTag } from '../reporting/states-copy.ts';
import type { PortalDeliverable } from '../portal/progress.ts';
import type {
    ApprovalDocStatus,
    CampaignGoalStatus,
    CampaignPlanStatus,
    DeliverableType,
    Task,
} from '../types.ts';
import {
    APPROVAL_DOC_STATUS_LABELS,
    CAMPAIGN_GOAL_STATUS_LABELS,
    CAMPAIGN_PLAN_STATUS_LABELS,
    DELIVERABLE_TYPE_LABELS,
    PORTAL_WORK_STATUS_LABELS,
    RECEIPT_TAG_LABELS,
    REPORT_STATUS_LABELS,
    TASK_STATUS_LABELS,
    campaignGoalStatusLabel,
    deliverableTypeLabel,
    portalWorkStatusLabel,
    receiptTagLabel,
    reportStatusLabel,
    taskStatusLabel,
    type ReportStatus,
} from './labels.ts';

const BANNED = /\b(GSC|GA4|CTR|GBP|GTM)\b/;

function covers<T extends string>(name: string, values: readonly T[], labels: Record<T, string>): void {
    assert.deepEqual(Object.keys(labels).sort(), [...values].sort(), `${name} is missing or has an extra stored value`);
    for (const value of values) {
        const label = labels[value];
        assert.equal(typeof label, 'string', value);
        assert.ok(label.length > 0, `${name}.${value}`);
        assert.equal(label.includes('_'), false, `${name}.${value} = ${label}`);
        assert.doesNotMatch(label, BANNED, `${name}.${value} = ${label}`);
    }
}

const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const satisfies readonly Task['status'][];
const REPORT_STATUSES = ['draft', 'published'] as const satisfies readonly ReportStatus[];
const PLAN_STATUSES = ['draft', 'internal_review', 'approved', 'active', 'archived'] as const satisfies readonly CampaignPlanStatus[];
const GOAL_STATUSES = ['active', 'achieved', 'at_risk', 'dropped'] as const satisfies readonly CampaignGoalStatus[];
const APPROVAL_STATUSES = ['pending', 'approved', 'approved_with_edits', 'changes_requested'] as const satisfies readonly ApprovalDocStatus[];
const PORTAL_STATUSES = ['in_progress', 'in_review', 'approved', 'published', 'delivered'] as const satisfies readonly PortalDeliverable['status'][];
const RECEIPT_TAGS = ['prelim', 'snapshot', 'ref'] as const satisfies readonly ReceiptTag[];
const DELIVERABLE_TYPES = ['Content', 'Backlink', 'GBP', 'Other'] as const satisfies readonly DeliverableType[];

test('every stored value in each label map has a plain label', () => {
    covers('task', TASK_STATUSES, TASK_STATUS_LABELS);
    covers('report', REPORT_STATUSES, REPORT_STATUS_LABELS);
    covers('campaign plan', PLAN_STATUSES, CAMPAIGN_PLAN_STATUS_LABELS);
    covers('campaign goal', GOAL_STATUSES, CAMPAIGN_GOAL_STATUS_LABELS);
    covers('approval', APPROVAL_STATUSES, APPROVAL_DOC_STATUS_LABELS);
    covers('portal work', PORTAL_STATUSES, PORTAL_WORK_STATUS_LABELS);
    covers('receipt tag', RECEIPT_TAGS, RECEIPT_TAG_LABELS);
    covers('deliverable type', DELIVERABLE_TYPES, DELIVERABLE_TYPE_LABELS);
});

test('lookups agree with the maps', () => {
    for (const status of TASK_STATUSES) assert.equal(taskStatusLabel(status), TASK_STATUS_LABELS[status]);
    for (const status of REPORT_STATUSES) assert.equal(reportStatusLabel(status), REPORT_STATUS_LABELS[status]);
    for (const status of GOAL_STATUSES) assert.equal(campaignGoalStatusLabel(status), CAMPAIGN_GOAL_STATUS_LABELS[status]);
    for (const status of PORTAL_STATUSES) assert.equal(portalWorkStatusLabel(status), PORTAL_WORK_STATUS_LABELS[status]);
    for (const tag of RECEIPT_TAGS) assert.equal(receiptTagLabel(tag), RECEIPT_TAG_LABELS[tag]);
    for (const type of DELIVERABLE_TYPES) assert.equal(deliverableTypeLabel(type), DELIVERABLE_TYPE_LABELS[type]);
    assert.equal(CAMPAIGN_GOAL_STATUS_LABELS.at_risk, 'At risk');
    assert.equal(PORTAL_WORK_STATUS_LABELS.in_review, 'Internal review');
});

test('an unknown status stays visible instead of going blank', () => {
    assert.equal(taskStatusLabel('archived'), 'archived');
    assert.equal(reportStatusLabel('approved'), 'approved');
});

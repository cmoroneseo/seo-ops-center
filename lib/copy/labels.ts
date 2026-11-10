/**
 * One map from stored values to the words a person sees.
 * Database values, routes, and enum members stay unchanged.
 */

import type { ApprovalDocStatus, CampaignGoalStatus, CampaignPlanStatus, Task } from '../types.ts';

export const TASK_STATUS_LABELS: Record<Task['status'], string> = {
    todo: 'To Do',
    in_progress: 'In Progress',
    done: 'Done',
};

export const REPORT_STATUS_LABELS = {
    draft: 'Draft',
    published: 'Published',
} as const;

export const CAMPAIGN_PLAN_STATUS_LABELS: Record<CampaignPlanStatus, string> = {
    draft: 'Draft',
    internal_review: 'In review',
    approved: 'Approved',
    active: 'Active',
    archived: 'Archived',
};

export const CAMPAIGN_GOAL_STATUS_LABELS: Record<CampaignGoalStatus, string> = {
    active: 'Active',
    achieved: 'Achieved',
    at_risk: 'At risk',
    dropped: 'Dropped',
};

export const APPROVAL_DOC_STATUS_LABELS: Record<ApprovalDocStatus, string> = {
    pending: 'Awaiting your review',
    approved: 'Approved',
    approved_with_edits: 'Approved with edits',
    changes_requested: 'Changes requested',
};

/** Work a client sees on the portal. Stored values stay snake_case. */
export const PORTAL_WORK_STATUS_LABELS = {
    in_progress: 'In progress',
    in_review: 'In review',
    approved: 'Approved, waiting to go live',
    published: 'Published',
    delivered: 'Delivered',
} as const;

/** Short mark beside a saved number. The stored tag stays prelim | snapshot | ref. */
export const RECEIPT_TAG_LABELS = {
    prelim: 'Early',
    snapshot: 'Saved',
    ref: 'Reference',
} as const;

export const DELIVERABLE_TYPE_LABELS: Record<string, string> = {
    Content: 'Content',
    Backlink: 'Links',
    GBP: 'Business Profile',
    Other: 'Other',
};

export function taskStatusLabel(status: string): string {
    return TASK_STATUS_LABELS[status as Task['status']] ?? status;
}

export function reportStatusLabel(status: string): string {
    return REPORT_STATUS_LABELS[status as keyof typeof REPORT_STATUS_LABELS] ?? status;
}

export function campaignGoalStatusLabel(status: string): string {
    return CAMPAIGN_GOAL_STATUS_LABELS[status as CampaignGoalStatus] ?? status;
}

export function portalWorkStatusLabel(status: string): string {
    return PORTAL_WORK_STATUS_LABELS[status as keyof typeof PORTAL_WORK_STATUS_LABELS] ?? status;
}

export function receiptTagLabel(tag: string): string {
    return RECEIPT_TAG_LABELS[tag as keyof typeof RECEIPT_TAG_LABELS] ?? tag;
}

export function deliverableTypeLabel(type: string): string {
    return DELIVERABLE_TYPE_LABELS[type] ?? type;
}

/**
 * Review state machine. The database trigger allows the same edges.
 * Nothing here sends email. Scheduling only records a Pacific send instant.
 */

import { reportSendInstant } from './business-days';
import type { PresendCheck } from './presend-checks';
import type { VersionReason } from './versions';

export type ReviewState = 'draft' | 'ready_for_review' | 'approved' | 'scheduled' | 'sent';

export type ReviewActionName = 'submit' | 'approve' | 'correct' | 'schedule' | 'unschedule';

export interface ReviewRecord {
    exists: boolean;
    state: ReviewState;
    requiresOwnerApproval: boolean;
    amApprovedBy: string | null;
    ownerApprovedBy: string | null;
    currentVersionId: string | null;
    recipientContactId: string | null;
    scheduledFor: string | null;
    sentAt: string | null;
}

export interface Actor {
    userId: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
}

export interface PlanSuccess {
    ok: true;
    capture: boolean;
    reason: VersionReason | null;
    toState: ReviewState;
    requiresOwnerApproval: boolean;
    amApprovedBy: string | null;
    ownerApprovedBy: string | null;
    stampAm: boolean;
    stampOwner: boolean;
    currentVersionId: string | null;
    recipientContactId: string | null;
    scheduledFor: string | null;
    sentAt: string | null;
    updatePortal: boolean;
    publishReport: boolean;
    notifyClient: false;
}

export type PlanResult = PlanSuccess | { ok: false; status: 400 | 403 | 409; error: string };

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export function emptyReview(): ReviewRecord {
    return {
        exists: false,
        state: 'draft',
        requiresOwnerApproval: false,
        amApprovedBy: null,
        ownerApprovedBy: null,
        currentVersionId: null,
        recipientContactId: null,
        scheduledFor: null,
        sentAt: null,
    };
}

/** New clients, and the first two reports for any client, need the organization owner. */
export function needsOwnerApproval(input: {
    clientCreatedAt: string | null;
    now: Date;
    reportCount: number;
}): boolean {
    if (input.reportCount <= 2) return true;
    if (!input.clientCreatedAt) return true;
    const created = new Date(input.clientCreatedAt);
    if (Number.isNaN(created.getTime())) return true;
    return input.now.getTime() - created.getTime() < NINETY_DAYS_MS;
}

export interface CloseCard {
    reportId: string;
    clientId: string;
    reportMonth: string;
    state: ReviewState;
    lane: 'waiting_on_data' | null;
    column: 'blocked' | 'ready' | 'approved' | 'sent' | null;
    blockingCount: number;
    warnCount: number;
    schedulingWaitsForRecipient: boolean;
    requiresOwnerApproval: boolean;
    ownerApprovalPending: boolean;
    trackerWarning: boolean;
}

/** Shape the month-close board can render without another query per card. */
export function closeCard(input: {
    reportId: string;
    clientId: string;
    reportMonth: string;
    state: ReviewState;
    gscConnected: boolean;
    hasRecipient: boolean;
    requiresOwnerApproval: boolean;
    ownerApprovalPending: boolean;
    checks: PresendCheck[];
}): CloseCard {
    const blockingCount = input.checks.filter(check => check.severity === 'blocking' && !check.ok).length;
    const warnCount = input.checks.filter(check => check.severity === 'warn' && !check.ok).length;
    const trackerWarning = input.checks.some(check => check.source === 'ahrefs' && !check.ok);
    const frozen = input.state === 'approved' || input.state === 'scheduled' || input.state === 'sent';
    if (!input.gscConnected && !frozen) {
        return {
            reportId: input.reportId,
            clientId: input.clientId,
            reportMonth: input.reportMonth,
            state: input.state,
            lane: 'waiting_on_data',
            column: null,
            blockingCount,
            warnCount,
            schedulingWaitsForRecipient: !input.hasRecipient,
            requiresOwnerApproval: input.requiresOwnerApproval,
            ownerApprovalPending: input.ownerApprovalPending,
            trackerWarning,
        };
    }
    let column: CloseCard['column'] = 'ready';
    if (input.state === 'sent') column = 'sent';
    else if (input.state === 'approved' || input.state === 'scheduled') column = 'approved';
    else if (blockingCount > 0) column = 'blocked';
    return {
        reportId: input.reportId,
        clientId: input.clientId,
        reportMonth: input.reportMonth,
        state: input.state,
        lane: null,
        column,
        blockingCount,
        warnCount,
        schedulingWaitsForRecipient: !input.hasRecipient,
        requiresOwnerApproval: input.requiresOwnerApproval,
        ownerApprovalPending: input.ownerApprovalPending,
        trackerWarning,
    };
}

function frozen(review: ReviewRecord): boolean {
    return review.state === 'approved' || review.state === 'scheduled' || review.state === 'sent';
}

export function planReviewAction(input: {
    review: ReviewRecord;
    action: ReviewActionName;
    actor: Actor;
    note: string | null;
    hasRecipient: boolean;
    recipientContactId: string | null;
    clientCreatedAt: string | null;
    reportCount: number;
    reportMonth: string;
    now: Date;
    extraHolidays?: readonly string[];
    checksPass: boolean;
}): PlanResult {
    const { review, actor, action } = input;
    if (actor.role === 'viewer') return { ok: false, status: 403, error: 'Forbidden' };

    const required = review.exists && review.amApprovedBy
        ? review.requiresOwnerApproval
        : needsOwnerApproval(input);

    const base = {
        ok: true as const,
        capture: false,
        reason: null,
        toState: review.state,
        requiresOwnerApproval: required,
        amApprovedBy: review.amApprovedBy,
        ownerApprovedBy: review.ownerApprovedBy,
        stampAm: false,
        stampOwner: false,
        currentVersionId: review.currentVersionId,
        recipientContactId: input.recipientContactId ?? review.recipientContactId,
        scheduledFor: review.scheduledFor,
        sentAt: review.sentAt,
        updatePortal: false,
        publishReport: false,
        notifyClient: false as const,
    };

    if (action === 'submit') {
        if (review.exists && review.state !== 'draft') return { ok: false, status: 409, error: 'This report is already in review.' };
        if (!input.checksPass) return { ok: false, status: 409, error: 'Resolve the blocking checks before review.' };
        return { ...base, toState: 'ready_for_review', requiresOwnerApproval: needsOwnerApproval(input) };
    }

    if (action === 'schedule') {
        if (review.state !== 'approved') return { ok: false, status: 409, error: 'Approve the report before scheduling it.' };
        if (!input.hasRecipient || !base.recipientContactId) {
            return { ok: false, status: 409, error: 'Scheduling waits for a portal recipient.' };
        }
        return {
            ...base,
            toState: 'scheduled',
            scheduledFor: reportSendInstant(input.reportMonth, input.now, input.extraHolidays).toISOString(),
        };
    }

    if (action === 'unschedule') {
        if (review.state !== 'scheduled') return { ok: false, status: 409, error: 'This report is not scheduled.' };
        return { ...base, toState: 'approved', scheduledFor: null };
    }

    if (action === 'correct') {
        if (!frozen(review)) return { ok: false, status: 409, error: 'Approve the report before correcting it.' };
        if (!input.note?.trim()) return { ok: false, status: 400, error: 'Add a correction note.' };
        if (!input.checksPass) return { ok: false, status: 409, error: 'Resolve the blocking checks before correcting.' };
        const owner = needsOwnerApproval(input);
        return {
            ...base,
            capture: true,
            reason: 'correction',
            toState: owner ? 'ready_for_review' : 'approved',
            requiresOwnerApproval: owner,
            amApprovedBy: actor.userId,
            ownerApprovedBy: null,
            stampAm: true,
            stampOwner: false,
            currentVersionId: null,
            scheduledFor: null,
            sentAt: null,
            updatePortal: !owner,
            publishReport: true,
        };
    }

    if (review.state === 'approved' || review.state === 'scheduled' || review.state === 'sent') {
        return { ok: false, status: 409, error: 'This report is already approved.' };
    }

    const waitingOnOwner = Boolean(review.amApprovedBy && review.currentVersionId && required && !review.ownerApprovedBy);
    if (waitingOnOwner) {
        if (actor.role !== 'owner') {
            return { ok: false, status: 403, error: 'The organization owner still has to approve this report.' };
        }
        return {
            ...base,
            toState: 'approved',
            ownerApprovedBy: actor.userId,
            stampOwner: true,
            updatePortal: true,
            publishReport: true,
        };
    }

    if (!input.checksPass) return { ok: false, status: 409, error: 'Resolve the blocking checks before approving.' };
    const owner = needsOwnerApproval(input);
    return {
        ...base,
        capture: true,
        reason: 'approval',
        toState: owner ? 'ready_for_review' : 'approved',
        requiresOwnerApproval: owner,
        amApprovedBy: actor.userId,
        ownerApprovedBy: null,
        stampAm: true,
        currentVersionId: null,
        scheduledFor: null,
        sentAt: null,
        updatePortal: !owner,
        publishReport: !owner,
    };
}

export function ownerApprovalPending(review: ReviewRecord): boolean {
    return review.state === 'ready_for_review'
        && review.requiresOwnerApproval
        && Boolean(review.amApprovedBy)
        && !review.ownerApprovedBy;
}

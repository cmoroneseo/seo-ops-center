import type { MarketingPlan, MarketingPlanItem } from '@/lib/types';

/**
 * Client-safe slices of fulfillment, the SEO plan, and the pending inbox.
 * These functions return new objects — they never pass internal fields through.
 */

export type ProgressBucket = 'in_progress' | 'shipped';

export interface PortalDeliverable {
    id: string;
    title: string;
    type: string;
    subtype?: string;
    bucket: ProgressBucket;
    month?: string;
    publishedUrl?: string;
    deliveredOn?: string;
    dueDate?: string;
    status: 'in_progress' | 'in_review' | 'approved' | 'published' | 'delivered';
}

const SHIPPED = new Set(['Approved', 'Published']);
const IN_PROGRESS = new Set(['In Progress', 'Review']);

export function recentMonthKeys(today: Date): [string, string] {
    const year = today.getUTCFullYear();
    const monthIndex = today.getUTCMonth();
    const current = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    const previousDate = new Date(Date.UTC(year, monthIndex - 1, 1));
    const previous = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, '0')}`;
    return [current, previous];
}

export function isRecentShipped(
    month: string | null | undefined,
    deliveredOn: string | null | undefined,
    recentMonths: readonly string[],
): boolean {
    if (month && recentMonths.includes(month)) return true;
    if (deliveredOn && recentMonths.some(key => deliveredOn.startsWith(key))) return true;
    return false;
}

export function portalDeliverable(
    input: {
        id: string;
        title: string;
        type: string;
        subtype?: string | null;
        status: string;
        month?: string | null;
        publishedUrl?: string | null;
        deliveredOn?: string | null;
        dueDate?: string | null;
    },
    recentMonths: readonly string[],
): PortalDeliverable | null {
    let bucket: ProgressBucket | null = null;
    const delivered = input.status === 'Published' || (input.status === 'Approved' && Boolean(input.deliveredOn));
    if (IN_PROGRESS.has(input.status) || (input.status === 'Approved' && !delivered)) bucket = 'in_progress';
    else if (SHIPPED.has(input.status) && isRecentShipped(input.month, input.deliveredOn, recentMonths)) bucket = 'shipped';
    if (!bucket) return null;

    const item: PortalDeliverable = {
        id: input.id,
        title: input.title,
        type: input.type,
        bucket,
        status: input.status === 'Published' ? 'published' : delivered ? 'delivered' : input.status === 'Approved' ? 'approved' : input.status === 'Review' ? 'in_review' : 'in_progress',
    };
    if (input.subtype) item.subtype = input.subtype;
    if (input.month) item.month = input.month;
    if (input.dueDate) item.dueDate = input.dueDate.slice(0, 10);
    const publishedUrl = safePublicUrl(input.publishedUrl);
    if (bucket === 'shipped' && input.status === 'Published' && publishedUrl) {
        item.publishedUrl = publishedUrl;
    }
    if (bucket === 'shipped' && input.deliveredOn) item.deliveredOn = input.deliveredOn;
    return item;
}

function safePublicUrl(value?: string | null): string | undefined {
    if (!value) return undefined;
    try {
        const url = new URL(value);
        if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString();
    } catch {
        return undefined;
    }
    return undefined;
}

export function labelSubtype(value?: string): string | undefined {
    if (!value) return undefined;
    const words = value.replace(/_/g, ' ').trim();
    if (!words) return undefined;
    return words.replace(/\b\w/g, char => char.toUpperCase()).replace(/\b(Seo|Gbp|Ai)\b/g, word => word.toUpperCase());
}

export interface PortalPlanItem {
    id: string;
    stepKey: string;
    title: string;
    description?: string;
    status: 'todo' | 'done';
    dueDate?: string;
    sortOrder: number;
}

export interface PortalPlanStep {
    key: string;
    name: string;
    sortOrder: number;
}

/** Ignored checklist rows are an internal skip and never reach the client. */
export function portalPlanItem(input: {
    id: string;
    stepKey: string;
    title: string;
    description?: string | null;
    status: string;
    dueDate?: string | null;
    sortOrder?: number | null;
}): PortalPlanItem | null {
    if (input.status !== 'todo' && input.status !== 'done') return null;
    const item: PortalPlanItem = {
        id: input.id,
        stepKey: input.stepKey,
        title: input.title,
        status: input.status,
        sortOrder: input.sortOrder ?? 0,
    };
    const description = input.description?.trim();
    if (description) item.description = description;
    if (input.dueDate) item.dueDate = input.dueDate;
    return item;
}

export type PlanDecisionState = 'hidden' | 'awaiting' | 'approved' | 'changes_requested';

export function planDecisionState(input: {
    shared: boolean;
    approvalRequestedAt?: string | null;
    latest?: { decision: 'approved' | 'changes_requested'; decidedAt: string } | null;
}): PlanDecisionState {
    if (!input.shared) return 'hidden';
    const latest = input.latest;
    const requested = input.approvalRequestedAt;
    if (!latest || !requested || latest.decidedAt < requested) return 'awaiting';
    return latest.decision;
}

export function decisionActionAllowed(
    state: PlanDecisionState,
    action: 'approved' | 'changes_requested',
): boolean {
    if (state === 'hidden') return false;
    if (state === 'awaiting') return true;
    return state !== action;
}

export type PendingKind = 'plan' | 'waiting_item' | 'content_review';

export interface PortalPendingItem {
    id: string;
    kind: PendingKind;
    title: string;
    detail?: string;
    href: string;
    external: boolean;
}

export function buildPendingInbox(input: {
    plan: { needsDecision: boolean; title: string } | null;
    waiting: { id: string; title: string; detail?: string | null }[];
    reviews: { id: string; name: string }[];
}): PortalPendingItem[] {
    const items: PortalPendingItem[] = [];
    if (input.plan?.needsDecision) {
        items.push({
            id: 'plan',
            kind: 'plan',
            title: input.plan.title || 'SEO Plan',
            detail: 'Review the plan and approve it, or tell the team what to change.',
            href: '/portal/plan',
            external: false,
        });
    }
    for (const item of input.waiting) {
        const entry: PortalPendingItem = {
            id: item.id,
            kind: 'waiting_item',
            title: item.title,
            href: `/portal/pending#waiting-${item.id}`,
            external: false,
        };
        const detail = item.detail?.trim();
        if (detail) entry.detail = detail;
        items.push(entry);
    }
    for (const review of input.reviews) {
        items.push({
            id: review.id,
            kind: 'content_review',
            title: review.name,
            detail: 'Your content is ready. Review it and share your approval or feedback.',
            href: `/api/client-portal/review-handoff/${review.id}`,
            external: true,
        });
    }
    return items;
}

/** Checklist rows for the shared report block. Comments, assignees, and tasks are blank on purpose. */
export function checklistPlan(input: {
    planId: string;
    title: string;
    steps: PortalPlanStep[];
    items: PortalPlanItem[];
    createdAt?: string;
    organizationId: string;
    clientId: string;
}): MarketingPlan {
    const items: MarketingPlanItem[] = input.items.map(item => ({
        id: item.id,
        marketingPlanId: input.planId,
        organizationId: input.organizationId,
        clientId: input.clientId,
        stepKey: item.stepKey,
        title: item.title,
        description: item.description,
        status: item.status,
        priority: 'medium',
        sortOrder: item.sortOrder,
        dueDate: item.dueDate,
        comments: [],
        isCustom: false,
        createdAt: input.createdAt ?? '',
        updatedAt: input.createdAt ?? '',
    }));
    return {
        id: input.planId,
        organizationId: input.organizationId,
        clientId: input.clientId,
        title: input.title,
        steps: input.steps,
        createdAt: input.createdAt ?? '',
        updatedAt: input.createdAt ?? '',
        items,
    };
}

export interface PortalFeedbackEntry {
    id: string;
    subjectType: 'plan' | 'waiting_item' | 'general';
    authorType?: 'client' | 'team';
    subjectId: string;
    authorLabel: string;
    body: string;
    createdAt: string;
}

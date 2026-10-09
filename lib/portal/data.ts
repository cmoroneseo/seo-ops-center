import { cache } from 'react';
import { metricNumber, portalToday, type PortalPerformanceMonth } from './dashboard';
import { createAdminClient } from '@/lib/supabase/admin';
import { SEO_PLAN_LABEL } from '@/lib/marketing-plan-template';
import type { MarketingPlan } from '@/lib/types';
import { capturePlan, publishedItems, type PortalPlanSnapshot } from './publication';
import { rowToPortalUpdate, type PortalUpdate } from './readiness';
import { previousMonth } from '@/lib/reports/sections';
import type { ReportSectionsField } from '@/lib/reports/blocks';
import { isUuid } from './access-policy';
import {
    buildPendingInbox, planDecisionState, portalDeliverable, recentMonthKeys,
    type PlanDecisionState, type PortalDeliverable, type PortalFeedbackEntry, type PortalPendingItem,
    type PortalPlanItem, type PortalPlanStep,
} from './progress';
import type { PortalClientScope } from './session';

export interface PortalPlanView {
    shared: boolean;
    planId?: string;
    title: string;
    steps: PortalPlanStep[];
    items: PortalPlanItem[];
    createdAt?: string;
    state: PlanDecisionState;
    approvalRequestedAt?: string;
    revisionId?: string;
    version?: number;
    publishedAt?: string;
    askedAgain: boolean;
    decision?: {
        decision: 'approved' | 'changes_requested';
        actorLabel: string;
        decidedAt: string;
        note?: string;
    };
    feedback: PortalFeedbackEntry[];
}

export interface PortalReportSummary {
    id: string;
    title: string;
    reportMonth: string;
    sharedAt: string;
}

export interface PortalReportDetail extends PortalReportSummary {
    executiveSummary: string;
    recommendations: string;
    sections: ReportSectionsField;
    metrics: {
        current: Record<string, Record<string, unknown>>;
        previous: Record<string, Record<string, unknown>>;
        updatedAt?: Record<string, string | null>;
    };
    history: Record<string, { month: string; data: Record<string, unknown> }[]>;
    planSnapshot: { plan: MarketingPlan } | null;
}

export interface PortalHome {
    waiting: PortalPendingItem[];
    inProgress: PortalDeliverable[];
    shipped: PortalDeliverable[];
    plan: PortalPlanView;
    latestReport: PortalReportSummary | null;
    performance: PortalPerformanceMonth[];
    update: PortalUpdate | null;
    managerName: string;
    analyticsShared: boolean;
    analyticsSyncedAt?: string;
}

export function feedbackFrom(rows: Record<string, unknown>[]): PortalFeedbackEntry[] {
    return rows.map(row => ({
        id: String(row.id),
        subjectType: row.subject_type as PortalFeedbackEntry['subjectType'],
        authorType: row.staff_user_id ? 'team' : 'client',
        subjectId: String(row.subject_id),
        authorLabel: String(row.author_label),
        body: String(row.body),
        createdAt: String(row.created_at),
    }));
}

const loadPlan = cache(async (contact: PortalClientScope): Promise<PortalPlanView> => {
    const admin = createAdminClient();
    const empty: PortalPlanView = {
        shared: false,
        title: SEO_PLAN_LABEL,
        steps: [],
        items: [],
        state: 'hidden',
        askedAgain: false,
        feedback: [],
    };

    const { data: share, error: shareError } = await admin
        .from('client_portal_plan_shares')
        .select('id,marketing_plan_id,approval_requested_at,snapshot,version,shared_at')
        .eq('client_id', contact.clientId)
        .eq('organization_id', contact.organizationId)
        .is('unshared_at', null)
        .maybeSingle();
    if (shareError) throw new Error('Could not load the shared plan');
    if (!share) return empty;

    const planId = share.marketing_plan_id as string;
    // Legacy unsnapshotted shares require deliberate republication. Never imply
    // an old approval covered the current editable document.
    if (!share.snapshot) return empty;
    const plan = share.snapshot as unknown as PortalPlanSnapshot;
    const [current, { data: decisionRows, error: decisionError }, { data: feedbackRows, error: feedbackError }] = await Promise.all([
        capturePlan(contact),
        admin.from('client_portal_plan_decisions').select('decision,actor_label,decided_at,note')
            .eq('plan_share_id', share.id).eq('client_id', contact.clientId).eq('organization_id', contact.organizationId)
            .order('decided_at', { ascending: false }).limit(1),
        admin.from('client_portal_feedback').select('id,subject_type,subject_id,author_label,body,created_at,staff_user_id')
            .eq('client_id', contact.clientId).eq('organization_id', contact.organizationId)
            .eq('subject_type', 'plan').eq('subject_id', planId).order('created_at'),
    ]);
    if (decisionError || feedbackError) throw new Error('Could not load the shared plan');
    const latest = decisionRows?.[0];
    const approvalRequestedAt = String(share.approval_requested_at);
    const latestDecision = latest
        ? {
            decision: latest.decision as 'approved' | 'changes_requested',
            decidedAt: String(latest.decided_at),
        }
        : null;
    const state = planDecisionState({ shared: true, approvalRequestedAt, latest: latestDecision });
    return {
        shared: true, planId, title: plan.title, steps: plan.steps,
        items: publishedItems(plan, current), createdAt: plan.createdAt,
        revisionId: String(share.id), version: Number(share.version), publishedAt: String(share.shared_at),
        state,
        approvalRequestedAt,
        askedAgain: Boolean(latestDecision && latestDecision.decidedAt < approvalRequestedAt),
        decision: latest && state !== 'awaiting'
            ? {
                decision: latest.decision as 'approved' | 'changes_requested',
                actorLabel: String(latest.actor_label),
                decidedAt: String(latest.decided_at),
                ...(latest.note ? { note: String(latest.note) } : {}),
            }
            : undefined,
        feedback: feedbackFrom(feedbackRows ?? []),
    };
});

const loadWaiting = cache(async (contact: PortalClientScope) => {
    const admin = createAdminClient();
    const { data, error } = await admin
        .from('client_portal_waiting_items')
        .select('id,title,detail,due_date,impact')
        .eq('client_id', contact.clientId)
        .eq('organization_id', contact.organizationId)
        .is('resolved_at', null)
        .order('created_at', { ascending: true });
    if (error) throw new Error('Could not load client requests');
    return (data ?? []).map(row => ({
        id: String(row.id),
        title: String(row.title),
        detail: row.detail ? String(row.detail) : null,
        dueDate: row.due_date ? String(row.due_date) : null,
        impact: row.impact ? String(row.impact) : null,
    }));
});

const loadReviews = cache(async (contact: PortalClientScope) => {
    const admin = createAdminClient();
    const { data, error } = await admin
        .from('content_approval_batches')
        .select('id, name')
        .eq('client_id', contact.clientId)
        .eq('organization_id', contact.organizationId)
        .eq('status', 'in_review')
        .order('sent_at', { ascending: false });
    if (error) throw new Error('Could not load content reviews');
    return (data ?? []).flatMap(row => {
        const id = String(row.id);
        if (!isUuid(id)) return [];
        return [{ id, name: String(row.name) }];
    });
});

const loadReportSummaries = cache(async (contact: PortalClientScope): Promise<PortalReportSummary[]> => {
    const admin = createAdminClient();
    const { data: shares, error: shareError } = await admin
        .from('client_portal_report_shares')
        .select('report_id,shared_at,snapshot')
        .eq('client_id', contact.clientId)
        .eq('organization_id', contact.organizationId)
        .is('unshared_at', null);
    if (shareError) throw new Error('Could not load shared reports');
    if (!shares?.length) return [];

    const ids = shares.map(share => share.report_id as string);
    const { data: reports, error: reportError } = await admin
        .from('reports')
        .select('id, title, report_month, status')
        .in('id', ids)
        .eq('client_id', contact.clientId)
        .eq('organization_id', contact.organizationId)
        .eq('status', 'published');

    if (reportError) throw new Error('Could not load shared reports');
    const sharesByReport = new Map(shares.map(share => [share.report_id as string, share]));
    return (reports ?? [])
        .map(report => ({
            id: String(report.id),
            title: String((sharesByReport.get(report.id)?.snapshot as PortalReportDetail | null)?.title ?? report.title),
            reportMonth: String((sharesByReport.get(report.id)?.snapshot as PortalReportDetail | null)?.reportMonth ?? report.report_month),
            sharedAt: String(sharesByReport.get(report.id)?.shared_at ?? ''),
        }))
        .sort((a, b) => b.reportMonth.localeCompare(a.reportMonth) || b.sharedAt.localeCompare(a.sharedAt));
});

export const loadPortalHome = cache(async (contact: PortalClientScope): Promise<PortalHome> => {
    const admin = createAdminClient();
    const months = recentMonthKeys(new Date(`${portalToday()}T12:00:00Z`));
    const [deliverableResult, plan, waiting, reviews, reports, metadata] = await Promise.all([
        admin.from('deliverables')
            .select('id, title, type, subtype, status, month, published_url, delivered_on, due_date')
            .eq('client_id', contact.clientId)
            .eq('organization_id', contact.organizationId)
            .in('status', ['In Progress', 'Review', 'Approved', 'Published']),
        loadPlan(contact),
        loadWaiting(contact),
        loadReviews(contact),
        loadReportSummaries(contact),
        loadPortalMetadata(contact),
    ]);

    if (deliverableResult.error) throw new Error('Could not load client progress');
    const performance = await loadPortalPerformance(contact, reports, metadata.analyticsShared);
    const progress = (deliverableResult.data ?? []).flatMap(row => {
        const item = portalDeliverable({
            id: String(row.id),
            title: String(row.title),
            type: String(row.type),
            subtype: row.subtype as string | null,
            status: String(row.status),
            month: row.month as string | null,
            publishedUrl: row.published_url as string | null,
            dueDate: row.due_date ? String(row.due_date) : null,
            deliveredOn: row.delivered_on ? String(row.delivered_on) : null,
        }, months);
        const timing = metadata.timing.find(row => row.deliverable_id === item?.id);
        if (item && timing) { item.timingNote = timing.timing_note; item.revisedDueDate = timing.revised_due_date ?? undefined; item.responsibility = timing.responsibility; }
        return item ? [item] : [];
    });

    const waitingInbox = buildPendingInbox({
        plan: plan.shared ? { needsDecision: plan.state === 'awaiting', title: plan.title } : null,
        waiting,
        reviews,
    });

    return {
        waiting: waitingInbox,
        inProgress: progress.filter(item => item.bucket === 'in_progress'),
        shipped: progress
            .filter(item => item.bucket === 'shipped')
            .sort((a, b) => (b.deliveredOn ?? b.month ?? '').localeCompare(a.deliveredOn ?? a.month ?? '')),
        plan,
        latestReport: reports[0] ?? null,
        performance,
        update: metadata.update, managerName: metadata.managerName, analyticsShared: metadata.analyticsShared, analyticsSyncedAt: metadata.analyticsSyncedAt,
    };
});

export async function loadPortalPlan(contact: PortalClientScope): Promise<PortalPlanView> {
    return loadPlan(contact);
}

export async function loadPortalPending(contact: PortalClientScope): Promise<{
    items: PortalPendingItem[];
    feedback: PortalFeedbackEntry[];
}> {
    const admin = createAdminClient();
    const [plan, waiting, reviews, feedbackResult] = await Promise.all([
        loadPlan(contact),
        loadWaiting(contact),
        loadReviews(contact),
        admin.from('client_portal_feedback')
            .select('id, subject_type, subject_id, author_label, body, created_at, staff_user_id')
            .eq('client_id', contact.clientId)
            .eq('organization_id', contact.organizationId)
            .order('created_at', { ascending: true }),
    ]);
    if (feedbackResult.error) throw new Error('Could not load request notes');
    return {
        items: buildPendingInbox({
            plan: plan.shared ? { needsDecision: plan.state === 'awaiting', title: plan.title } : null,
            waiting,
            reviews,
        }),
        feedback: feedbackFrom(feedbackResult.data ?? []),
    };
}

export async function loadPortalReports(contact: PortalClientScope): Promise<PortalReportSummary[]> {
    return loadReportSummaries(contact);
}

export async function loadPortalReport(contact: PortalClientScope, reportId: string): Promise<PortalReportDetail | null> {
    if (!isUuid(reportId)) return null;
    const summaries = await loadReportSummaries(contact);
    const summary = summaries.find(report => report.id === reportId);
    if (!summary) return null;

    const { data: share, error } = await createAdminClient().from('client_portal_report_shares')
        .select('snapshot').eq('report_id', reportId).eq('client_id', contact.clientId)
        .eq('organization_id', contact.organizationId).is('unshared_at', null).maybeSingle();
    if (error) throw new Error('Could not load the published report');
    if (!share?.snapshot) return null;
    return { ...(share.snapshot as unknown as PortalReportDetail), ...summary };

}

export async function countPending(contact: PortalClientScope): Promise<number> {
    const [plan, waiting, reviews] = await Promise.all([loadPlan(contact), loadWaiting(contact), loadReviews(contact)]);
    return buildPendingInbox({ plan: plan.shared ? { needsDecision: plan.state === 'awaiting', title: plan.title } : null, waiting, reviews }).length;
}

/** Home performance follows published, explicitly shared reports only. */
async function loadPortalPerformance(contact: PortalClientScope, reports: PortalReportSummary[], analyticsShared: boolean): Promise<PortalPerformanceMonth[]> {
    if (analyticsShared) {
        const { data, error } = await createAdminClient().from('metrics').select('metric_month,data')
            .eq('client_id', contact.clientId).eq('organization_id', contact.organizationId).eq('source', 'gsc')
            .lt('metric_month', portalToday().slice(0, 7)).order('metric_month', { ascending: false }).limit(13);
        if (error) throw new Error('Could not load shared search performance');
        const rows = new Map((data ?? []).map(row => [String(row.metric_month), row.data as Record<string, unknown>]));
        return (data ?? []).slice(0, 12).map(row => ({ month: String(row.metric_month),
            reportId: reports.find(report => report.reportMonth === row.metric_month)?.id,
            clicks: metricNumber(row.data.organic_clicks), impressions: metricNumber(row.data.impressions),
            previousClicks: metricNumber(rows.get(previousMonth(row.metric_month))?.organic_clicks),
            previousImpressions: metricNumber(rows.get(previousMonth(row.metric_month))?.impressions) }));
    }
    if (!reports.length) return [];
    const recent = [...new Map(reports.map(report => [report.reportMonth, report])).values()].slice(0, 12);
    const details = await Promise.all(recent.map(report => loadPortalReport(contact, report.id)));
    return recent.map((report, index) => {
        const current = details[index]?.metrics.current.gsc;
        const previous = details[index]?.metrics.previous.gsc;
        return { month: report.reportMonth, reportId: report.id,
            clicks: metricNumber(current?.organic_clicks), impressions: metricNumber(current?.impressions),
            previousClicks: metricNumber(previous?.organic_clicks), previousImpressions: metricNumber(previous?.impressions) };
    });
}

export async function loadPortalMessages(contact: PortalClientScope): Promise<PortalFeedbackEntry[]> {
    const { data, error } = await createAdminClient().from('client_portal_feedback')
        .select('id, subject_type, subject_id, author_label, body, created_at, staff_user_id')
        .eq('client_id', contact.clientId).eq('organization_id', contact.organizationId)
        .eq('subject_type', 'general').eq('subject_id', contact.clientId)
        .order('created_at', { ascending: false }).limit(200);
    if (error) throw new Error('Could not load messages');
    return feedbackFrom([...(data ?? [])].reverse());
}


export const loadPortalMetadata = cache(async (contact: PortalClientScope) => {
    const admin = createAdminClient();
    const [update, settings, timing, client, integration] = await Promise.all([
        admin.from('client_portal_updates').select('id,author_label,shipped,impact,next_steps,blockers,next_update_on,published_at')
            .eq('client_id', contact.clientId).eq('organization_id', contact.organizationId).order('published_at', { ascending: false }).limit(1).maybeSingle(),
        admin.from('client_portal_settings').select('analytics_shared').eq('client_id', contact.clientId).eq('organization_id', contact.organizationId).maybeSingle(),
        admin.from('client_portal_delivery_updates').select('deliverable_id,timing_note,revised_due_date,responsibility')
            .eq('client_id', contact.clientId).eq('organization_id', contact.organizationId),
        admin.from('clients').select('account_manager_name').eq('id', contact.clientId).eq('organization_id', contact.organizationId).maybeSingle(),
        admin.from('client_integrations').select('last_synced_at').eq('client_id', contact.clientId).eq('organization_id', contact.organizationId).eq('service', 'gsc').maybeSingle(),
    ]);
    if ([update, settings, timing, client, integration].some(result => result.error)) throw new Error('Could not load campaign updates');
    return { update: update.data ? rowToPortalUpdate(update.data) : null, analyticsShared: settings.data?.analytics_shared === true,
        analyticsSyncedAt: settings.data?.analytics_shared && integration.data?.last_synced_at ? String(integration.data.last_synced_at) : undefined,
        timing: (timing.data ?? []) as { deliverable_id: string; timing_note: string; revised_due_date: string | null; responsibility: 'team' | 'client' }[],
        managerName: client.data?.account_manager_name ? String(client.data.account_manager_name) : 'Your account team' };
});

export async function loadPortalConversations(contact: PortalClientScope) {
    const admin = createAdminClient();
    const [plan, requests, feedback] = await Promise.all([
        loadPlan(contact),
        admin.from('client_portal_waiting_items').select('id,title,resolved_at').eq('client_id', contact.clientId).eq('organization_id', contact.organizationId),
        admin.from('client_portal_feedback').select('id,subject_type,subject_id,author_label,body,created_at,staff_user_id')
            .eq('client_id', contact.clientId).eq('organization_id', contact.organizationId).order('created_at', { ascending: false }).limit(200),
    ]);
    if (requests.error || feedback.error) throw new Error('Could not load conversations');
    const entries = feedbackFrom([...(feedback.data ?? [])].reverse());
    const general = { subjectType: 'general' as const, subjectId: contact.clientId, title: 'General conversation', closed: false };
    const threads = [general, ...(plan.shared && plan.planId ? [{ subjectType: 'plan' as const, subjectId: plan.planId, title: 'SEO Plan', closed: false }] : []),
        ...(requests.data ?? []).map(request => ({ subjectType: 'waiting_item' as const, subjectId: String(request.id), title: String(request.title), closed: Boolean(request.resolved_at) }))];
    return threads.map(thread => ({ ...thread, entries: entries.filter(entry => entry.subjectType === thread.subjectType && entry.subjectId === thread.subjectId) }))
        .filter(thread => thread.subjectType === 'general' || thread.entries.length > 0);
}

import { createAdminClient } from '@/lib/supabase/admin';
import { displaySeoPlanTitle, SEO_PLAN_LABEL } from '@/lib/marketing-plan-template';
import { getClientMetrics } from '@/lib/sync/upsertMetric';
import { previousMonth } from '@/lib/reports/sections';
import type { ReportSectionsField } from '@/lib/reports/blocks';
import { isUuid } from './access-policy';
import {
    buildPendingInbox, planDecisionState, portalDeliverable, portalPlanItem, recentMonthKeys,
    type PlanDecisionState, type PortalDeliverable, type PortalFeedbackEntry, type PortalPendingItem,
    type PortalPlanItem, type PortalPlanStep,
} from './progress';
import type { PortalContact } from './session';

export interface PortalPlanView {
    shared: boolean;
    planId?: string;
    title: string;
    steps: PortalPlanStep[];
    items: PortalPlanItem[];
    createdAt?: string;
    state: PlanDecisionState;
    approvalRequestedAt?: string;
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
    metrics: { current: Record<string, Record<string, unknown>>; previous: Record<string, Record<string, unknown>> };
    history: Record<string, { month: string; data: Record<string, unknown> }[]>;
}

export interface PortalHome {
    waiting: PortalPendingItem[];
    inProgress: PortalDeliverable[];
    shipped: PortalDeliverable[];
    plan: PortalPlanView;
    latestReport: PortalReportSummary | null;
}

function feedbackFrom(rows: Record<string, unknown>[]): PortalFeedbackEntry[] {
    return rows.map(row => ({
        id: String(row.id),
        subjectType: row.subject_type as 'plan' | 'waiting_item',
        subjectId: String(row.subject_id),
        authorLabel: String(row.author_label),
        body: String(row.body),
        createdAt: String(row.created_at),
    }));
}

async function loadPlan(contact: PortalContact): Promise<PortalPlanView> {
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

    const { data: share } = await admin
        .from('client_portal_plan_shares')
        .select('marketing_plan_id, approval_requested_at')
        .eq('client_id', contact.clientId)
        .eq('organization_id', contact.organizationId)
        .is('unshared_at', null)
        .maybeSingle();
    if (!share) return empty;

    const planId = share.marketing_plan_id as string;
    const [{ data: plan }, { data: itemRows }, { data: decisionRows }, { data: feedbackRows }] = await Promise.all([
        admin.from('marketing_plans').select('id, title, steps, created_at')
            .eq('id', planId)
            .eq('client_id', contact.clientId)
            .eq('organization_id', contact.organizationId)
            .maybeSingle(),
        admin.from('marketing_plan_items')
            .select('id, step_key, title, description, status, due_date, sort_order, linked_task:tasks(due_date, status, organization_id, client_id)')
            .eq('marketing_plan_id', planId)
            .eq('client_id', contact.clientId)
            .eq('organization_id', contact.organizationId)
            .order('sort_order', { ascending: true }),
        admin.from('client_portal_plan_decisions')
            .select('decision, actor_label, decided_at, note')
            .eq('marketing_plan_id', planId)
            .eq('client_id', contact.clientId)
            .order('decided_at', { ascending: false })
            .limit(1),
        admin.from('client_portal_feedback')
            .select('id, subject_type, subject_id, author_label, body, created_at')
            .eq('client_id', contact.clientId)
            .eq('organization_id', contact.organizationId)
            .eq('subject_type', 'plan')
            .eq('subject_id', planId)
            .order('created_at', { ascending: true }),
    ]);
    if (!plan) return empty;

    const latest = decisionRows?.[0];
    const approvalRequestedAt = String(share.approval_requested_at);
    const latestDecision = latest
        ? {
            decision: latest.decision as 'approved' | 'changes_requested',
            decidedAt: String(latest.decided_at),
        }
        : null;
    const state = planDecisionState({ shared: true, approvalRequestedAt, latest: latestDecision });
    const steps = Array.isArray(plan.steps) ? plan.steps as PortalPlanStep[] : [];

    return {
        shared: true,
        planId,
        title: displaySeoPlanTitle(String(plan.title || SEO_PLAN_LABEL)),
        steps: steps.map(step => {
            const raw = step as PortalPlanStep & { sort_order?: number };
            return {
                key: String(raw.key),
                name: String(raw.name),
                sortOrder: Number(raw.sortOrder ?? raw.sort_order ?? 0),
            };
        }),
        items: (itemRows ?? []).flatMap(row => {
            const linked = row.linked_task as unknown as { due_date: string | null; status: string; organization_id: string; client_id: string } | null;
            const scopedTask = linked?.organization_id === contact.organizationId && linked?.client_id === contact.clientId ? linked : null;
            const item = portalPlanItem({
                id: String(row.id),
                stepKey: String(row.step_key),
                title: String(row.title),
                description: row.description as string | null,
                status: row.status === 'ignored' ? 'ignored' : scopedTask ? (['done', 'approved'].includes(scopedTask.status) ? 'done' : 'todo') : String(row.status),
                dueDate: scopedTask ? scopedTask.due_date : row.due_date ? String(row.due_date).slice(0, 10) : null,
                sortOrder: row.sort_order as number | null,
            });
            return item ? [item] : [];
        }),
        createdAt: plan.created_at ? String(plan.created_at) : undefined,
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
}

async function loadWaiting(contact: PortalContact) {
    const admin = createAdminClient();
    const { data } = await admin
        .from('client_portal_waiting_items')
        .select('id, title, detail')
        .eq('client_id', contact.clientId)
        .eq('organization_id', contact.organizationId)
        .is('resolved_at', null)
        .order('created_at', { ascending: true });
    return (data ?? []).map(row => ({
        id: String(row.id),
        title: String(row.title),
        detail: row.detail ? String(row.detail) : null,
    }));
}

async function loadReviews(contact: PortalContact) {
    const admin = createAdminClient();
    const { data } = await admin
        .from('content_approval_batches')
        .select('id, name')
        .eq('client_id', contact.clientId)
        .eq('organization_id', contact.organizationId)
        .eq('status', 'in_review')
        .order('sent_at', { ascending: false });
    return (data ?? []).flatMap(row => {
        const id = String(row.id);
        if (!isUuid(id)) return [];
        return [{ id, name: String(row.name) }];
    });
}

async function loadReportSummaries(contact: PortalContact): Promise<PortalReportSummary[]> {
    const admin = createAdminClient();
    const { data: shares } = await admin
        .from('client_portal_report_shares')
        .select('report_id, shared_at')
        .eq('client_id', contact.clientId)
        .eq('organization_id', contact.organizationId)
        .is('unshared_at', null);
    if (!shares?.length) return [];

    const ids = shares.map(share => share.report_id as string);
    const { data: reports } = await admin
        .from('reports')
        .select('id, title, report_month, status')
        .in('id', ids)
        .eq('client_id', contact.clientId)
        .eq('organization_id', contact.organizationId)
        .eq('status', 'published');

    const sharedAt = new Map(shares.map(share => [share.report_id as string, String(share.shared_at)]));
    return (reports ?? [])
        .map(report => ({
            id: String(report.id),
            title: String(report.title),
            reportMonth: String(report.report_month),
            sharedAt: sharedAt.get(report.id as string) ?? '',
        }))
        .sort((a, b) => b.reportMonth.localeCompare(a.reportMonth) || b.sharedAt.localeCompare(a.sharedAt));
}

export async function loadPortalHome(contact: PortalContact): Promise<PortalHome> {
    const admin = createAdminClient();
    const months = recentMonthKeys(new Date());
    const [deliverableResult, plan, waiting, reviews, reports] = await Promise.all([
        admin.from('deliverables')
            .select('id, title, type, subtype, status, month, published_url, delivered_on')
            .eq('client_id', contact.clientId)
            .eq('organization_id', contact.organizationId)
            .in('status', ['In Progress', 'Review', 'Approved', 'Published']),
        loadPlan(contact),
        loadWaiting(contact),
        loadReviews(contact),
        loadReportSummaries(contact),
    ]);

    const progress = (deliverableResult.data ?? []).flatMap(row => {
        const item = portalDeliverable({
            id: String(row.id),
            title: String(row.title),
            type: String(row.type),
            subtype: row.subtype as string | null,
            status: String(row.status),
            month: row.month as string | null,
            publishedUrl: row.published_url as string | null,
            deliveredOn: row.delivered_on ? String(row.delivered_on) : null,
        }, months);
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
    };
}

export async function loadPortalPlan(contact: PortalContact): Promise<PortalPlanView> {
    return loadPlan(contact);
}

export async function loadPortalPending(contact: PortalContact): Promise<{
    items: PortalPendingItem[];
    feedback: PortalFeedbackEntry[];
}> {
    const admin = createAdminClient();
    const [plan, waiting, reviews, feedbackResult] = await Promise.all([
        loadPlan(contact),
        loadWaiting(contact),
        loadReviews(contact),
        admin.from('client_portal_feedback')
            .select('id, subject_type, subject_id, author_label, body, created_at')
            .eq('client_id', contact.clientId)
            .eq('organization_id', contact.organizationId)
            .order('created_at', { ascending: true }),
    ]);
    return {
        items: buildPendingInbox({
            plan: plan.shared ? { needsDecision: plan.state === 'awaiting', title: plan.title } : null,
            waiting,
            reviews,
        }),
        feedback: feedbackFrom(feedbackResult.data ?? []),
    };
}

export async function loadPortalReports(contact: PortalContact): Promise<PortalReportSummary[]> {
    return loadReportSummaries(contact);
}

export async function loadPortalReport(contact: PortalContact, reportId: string): Promise<PortalReportDetail | null> {
    if (!isUuid(reportId)) return null;
    const summaries = await loadReportSummaries(contact);
    const summary = summaries.find(report => report.id === reportId);
    if (!summary) return null;

    const admin = createAdminClient();
    const { data: report } = await admin
        .from('reports')
        .select('id, title, report_month, executive_summary, recommendations, sections, status, client_id, organization_id')
        .eq('id', reportId)
        .eq('client_id', contact.clientId)
        .eq('organization_id', contact.organizationId)
        .eq('status', 'published')
        .maybeSingle();
    if (!report) return null;

    const allRows = await getClientMetrics(contact.clientId);
    const toMap = (rows: { source: string; data: Record<string, unknown> }[]) =>
        Object.fromEntries(rows.map(row => [row.source, row.data]));
    const prevMonth = previousMonth(report.report_month as string);
    const history: Record<string, { month: string; data: Record<string, unknown> }[]> = {};
    for (const row of allRows) {
        if (!row.metric_month || row.metric_month > report.report_month) continue;
        (history[row.source] ??= []).push({ month: row.metric_month, data: row.data });
    }
    for (const source of Object.keys(history)) {
        history[source] = history[source].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
    }

    return {
        ...summary,
        title: String(report.title),
        reportMonth: String(report.report_month),
        executiveSummary: String(report.executive_summary ?? ''),
        recommendations: String(report.recommendations ?? ''),
        sections: (report.sections ?? null) as ReportSectionsField,
        metrics: {
            current: toMap(allRows.filter(row => row.metric_month === report.report_month)),
            previous: toMap(allRows.filter(row => row.metric_month === prevMonth)),
        },
        history,
    };
}

export async function countPending(contact: PortalContact): Promise<number> {
    const pending = await loadPortalPending(contact);
    return pending.items.length;
}

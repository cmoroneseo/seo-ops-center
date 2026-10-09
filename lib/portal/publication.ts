import { createAdminClient } from '@/lib/supabase/admin';
import { displaySeoPlanTitle, SEO_PLAN_LABEL } from '@/lib/marketing-plan-template';
import { clientSafeMetricData, previousMonth } from '@/lib/reports/sections';
import type { PortalClientScope } from './session';
import { checklistPlan, portalPlanItem, type PortalPlanItem, type PortalPlanStep } from './progress';
import type { PortalReportDetail } from './data';
import { blocksForClientRender, type ReportSectionsField } from '@/lib/reports/blocks';
import { assertShareCopy, copySourcesForMetrics } from '@/lib/reports/copy-rules';

export interface PortalPlanSnapshot {
    planId: string; title: string; steps: PortalPlanStep[]; items: PortalPlanItem[]; createdAt: string;
}

/** Only client-visible content is persisted; no comments, assignees, or task IDs. */
export async function capturePlan(scope: Pick<PortalClientScope, 'organizationId' | 'clientId'>): Promise<PortalPlanSnapshot | null> {
    const admin = createAdminClient();
    const { data: plan, error } = await admin.from('marketing_plans').select('id,title,steps,created_at')
        .eq('client_id', scope.clientId).eq('organization_id', scope.organizationId).maybeSingle();
    if (error) throw new Error('Could not load the SEO Plan');
    if (!plan) return null;
    const { data: rows, error: itemsError } = await admin.from('marketing_plan_items')
        .select('id,step_key,title,description,status,due_date,sort_order,linked_task:tasks(due_date,status,organization_id,client_id)')
        .eq('marketing_plan_id', plan.id).eq('client_id', scope.clientId).eq('organization_id', scope.organizationId)
        .order('sort_order');
    if (itemsError) throw new Error('Could not load plan activities');
    return { planId: String(plan.id), title: displaySeoPlanTitle(String(plan.title || SEO_PLAN_LABEL)),
        createdAt: String(plan.created_at),
        steps: (Array.isArray(plan.steps) ? plan.steps : []).map((step: PortalPlanStep & { sort_order?: number }) => ({
            key: String(step.key), name: String(step.name), sortOrder: Number(step.sortOrder ?? step.sort_order ?? 0),
        })),
        items: (rows ?? []).flatMap(row => {
            const task = row.linked_task as unknown as { due_date?: string; status: string; organization_id: string; client_id: string } | null;
            const scoped = task?.organization_id === scope.organizationId && task.client_id === scope.clientId ? task : null;
            const item = portalPlanItem({ id: String(row.id), stepKey: String(row.step_key), title: String(row.title),
                description: row.description, status: row.status === 'ignored' ? 'ignored' : scoped ? (['done', 'approved'].includes(scoped.status) ? 'done' : 'todo') : row.status,
                dueDate: scoped ? scoped.due_date : row.due_date, sortOrder: row.sort_order });
            return item ? [item] : [];
        }) };
}

/** Completion can move forward without silently changing approved scope/dates. */
export function publishedItems(snapshot: PortalPlanSnapshot, current: PortalPlanSnapshot | null): PortalPlanItem[] {
    const live = new Map(current?.items.map(item => [item.id, item.status]) ?? []);
    return snapshot.items.map(item => ({ ...item, status: live.get(item.id) ?? item.status }));
}

export function samePlanScope(a: PortalPlanSnapshot, b: PortalPlanSnapshot): boolean {
    const content = (plan: PortalPlanSnapshot) => JSON.stringify({ title: plan.title, steps: plan.steps,
        items: plan.items.map(item => ({ id: item.id, stepKey: item.stepKey, title: item.title, description: item.description, dueDate: item.dueDate, sortOrder: item.sortOrder })) });
    return content(a) === content(b);
}

export async function captureReport(scope: PortalClientScope, reportId: string, plan: PortalPlanSnapshot | null): Promise<PortalReportDetail | null> {
    const admin = createAdminClient();
    const [{ data: report, error }, { data: rows, error: metricError }] = await Promise.all([
        admin.from('reports').select('id,title,report_month,executive_summary,recommendations,sections')
            .eq('id', reportId).eq('client_id', scope.clientId).eq('organization_id', scope.organizationId).eq('status', 'published').maybeSingle(),
        admin.from('metrics').select('source,metric_month,data,updated_at').eq('client_id', scope.clientId).eq('organization_id', scope.organizationId)
            .order('metric_month', { ascending: false }),
    ]);
    if (error || metricError) throw new Error('Could not capture the report');
    if (!report) return null;
    const month = String(report.report_month);
    const metricData = (row: { data?: Record<string, unknown> | null }) => clientSafeMetricData((row.data ?? {}) as Record<string, unknown>);
    const metrics = (key: string) => Object.fromEntries((rows ?? []).filter(row => row.metric_month === key).map(row => [row.source, metricData(row)]));
    const history: PortalReportDetail['history'] = {};
    for (const row of rows ?? []) {
        if (!row.metric_month || row.metric_month > month) continue;
        (history[row.source] ??= []).push({ month: row.metric_month, data: metricData(row) });
    }
    for (const source of Object.keys(history)) history[source] = history[source].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
    const current = metrics(month);
    const blocks = blocksForClientRender(report.sections as ReportSectionsField);
    const executiveSummary = String(report.executive_summary ?? '');
    const recommendations = String(report.recommendations ?? '');
    assertShareCopy({ executiveSummary, recommendations, blocks, sources: copySourcesForMetrics(current) });
    const updatedAt = Object.fromEntries((rows ?? []).filter(row => row.metric_month === month).map(row => [row.source, row.updated_at ?? null]));
    return { id: String(report.id), title: String(report.title), reportMonth: month, sharedAt: '',
        executiveSummary, recommendations,
        sections: { version: 2 as const, blocks }, metrics: { current, previous: metrics(previousMonth(month)), updatedAt }, history,
        planSnapshot: plan ? { plan: checklistPlan({ ...plan, organizationId: scope.organizationId, clientId: scope.clientId }) } : null };
}

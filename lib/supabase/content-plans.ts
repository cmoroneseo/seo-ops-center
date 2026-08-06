import { createClient } from './client';
import { createTask } from './tasks';
import { createDeliverable } from './deliverables';
import {
    ContentOpportunity, ContentOpportunityStatus, ContentOpportunityType,
    ContentPlan, ContentPlanStatus, ContentPriority, SearchIntent, TopicCluster,
} from '../types';

export function rowToContentPlan(r: any): ContentPlan {
    return {
        id: r.id,
        organizationId: r.organization_id,
        clientId: r.client_id,
        name: r.name,
        status: r.status,
        periodStart: r.period_start ?? undefined,
        periodEnd: r.period_end ?? undefined,
        intelligenceVersion: r.intelligence_version ?? undefined,
        settings: r.settings ?? {},
        createdBy: r.created_by ?? undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

export function rowToTopicCluster(r: any): TopicCluster {
    return {
        id: r.id,
        organizationId: r.organization_id,
        contentPlanId: r.content_plan_id,
        name: r.name,
        seedKeyword: r.seed_keyword ?? undefined,
        primaryKeyword: r.primary_keyword ?? undefined,
        primaryTargetType: r.primary_target_type ?? undefined,
        primaryTargetUrl: r.primary_target_url ?? undefined,
        priority: r.priority,
        businessValue: r.business_value ?? undefined,
        sortOrder: r.sort_order ?? 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

export function rowToContentOpportunity(r: any): ContentOpportunity {
    return {
        id: r.id,
        organizationId: r.organization_id,
        contentPlanId: r.content_plan_id,
        topicClusterId: r.topic_cluster_id ?? undefined,
        opportunityType: r.opportunity_type,
        keyword: r.keyword ?? undefined,
        workingTitle: r.working_title,
        searchIntent: r.search_intent ?? undefined,
        status: r.status,
        priority: r.priority,
        existingUrl: r.existing_url ?? undefined,
        targetUrl: r.target_url ?? undefined,
        isQuestion: r.is_question ?? false,
        taskId: r.task_id ?? undefined,
        deliverableId: r.deliverable_id ?? undefined,
        assigneeId: r.assignee_id ?? undefined,
        dueDate: r.due_date ?? undefined,
        notes: r.notes ?? undefined,
        customFields: r.custom_fields ?? {},
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

export async function getContentPlans(organizationId: string, clientId?: string): Promise<ContentPlan[]> {
    const supabase = createClient();
    if (!supabase) return [];
    let query = supabase.from('content_plans').select('*').eq('organization_id', organizationId);
    if (clientId) query = query.eq('client_id', clientId);
    const { data, error } = await query.order('updated_at', { ascending: false });
    if (error) { console.error('getContentPlans:', error); return []; }
    if (!data?.length) return [];

    const ids = data.map((r: any) => r.id);
    const [{ data: clusters }, { data: opportunities }] = await Promise.all([
        supabase.from('topic_clusters').select('content_plan_id').in('content_plan_id', ids),
        supabase.from('content_opportunities').select('content_plan_id,status').in('content_plan_id', ids),
    ]);
    return data.map((row: any) => ({
        ...rowToContentPlan(row),
        clusters: (clusters ?? []).filter((c: any) => c.content_plan_id === row.id) as any,
        opportunities: (opportunities ?? []).filter((o: any) => o.content_plan_id === row.id) as any,
    }));
}

export async function getContentPlan(planId: string): Promise<ContentPlan | null> {
    const supabase = createClient();
    if (!supabase) return null;
    const [{ data: plan, error }, { data: clusters }, { data: opportunities }] = await Promise.all([
        supabase.from('content_plans').select('*').eq('id', planId).maybeSingle(),
        supabase.from('topic_clusters').select('*').eq('content_plan_id', planId).order('sort_order'),
        supabase.from('content_opportunities').select('*').eq('content_plan_id', planId).order('created_at'),
    ]);
    if (error || !plan) { if (error) console.error('getContentPlan:', error); return null; }
    return {
        ...rowToContentPlan(plan),
        clusters: (clusters ?? []).map(rowToTopicCluster),
        opportunities: (opportunities ?? []).map(rowToContentOpportunity),
    };
}

export async function createContentPlan(input: {
    organizationId: string; clientId: string; name: string;
    periodStart?: string; periodEnd?: string; intelligenceVersion?: number;
}): Promise<{ success: boolean; data?: ContentPlan; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    const { data, error } = await supabase.from('content_plans').insert({
        organization_id: input.organizationId,
        client_id: input.clientId,
        name: input.name.trim(),
        period_start: input.periodStart || null,
        period_end: input.periodEnd || null,
        intelligence_version: input.intelligenceVersion ?? null,
    }).select().single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToContentPlan(data) };
}

export async function updateContentPlan(
    planId: string,
    patch: { name?: string; status?: ContentPlanStatus; periodStart?: string | null; periodEnd?: string | null; intelligenceVersion?: number },
): Promise<{ success: boolean; data?: ContentPlan; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) row.name = patch.name.trim();
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.periodStart !== undefined) row.period_start = patch.periodStart || null;
    if (patch.periodEnd !== undefined) row.period_end = patch.periodEnd || null;
    if (patch.intelligenceVersion !== undefined) row.intelligence_version = patch.intelligenceVersion;
    const { data, error } = await supabase.from('content_plans').update(row).eq('id', planId).select().single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToContentPlan(data) };
}

export async function createTopicCluster(input: {
    organizationId: string; contentPlanId: string; name: string; seedKeyword?: string;
    priority?: ContentPriority; sortOrder?: number;
}): Promise<{ success: boolean; data?: TopicCluster; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    const { data, error } = await supabase.from('topic_clusters').insert({
        organization_id: input.organizationId,
        content_plan_id: input.contentPlanId,
        name: input.name.trim(),
        seed_keyword: input.seedKeyword?.trim() || null,
        priority: input.priority ?? 'medium',
        sort_order: input.sortOrder ?? 0,
    }).select().single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToTopicCluster(data) };
}

export async function updateTopicCluster(
    id: string,
    patch: Partial<Pick<TopicCluster, 'name' | 'seedKeyword' | 'primaryKeyword' | 'primaryTargetType' | 'primaryTargetUrl' | 'priority' | 'businessValue' | 'sortOrder'>>,
): Promise<{ success: boolean; data?: TopicCluster; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    const keyMap: Record<string, string> = {
        name: 'name', seedKeyword: 'seed_keyword', primaryKeyword: 'primary_keyword',
        primaryTargetType: 'primary_target_type', primaryTargetUrl: 'primary_target_url',
        priority: 'priority', businessValue: 'business_value', sortOrder: 'sort_order',
    };
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    Object.entries(patch).forEach(([key, value]) => { row[keyMap[key]] = value === '' ? null : value; });
    const { data, error } = await supabase.from('topic_clusters').update(row).eq('id', id).select().single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToTopicCluster(data) };
}

export async function deleteTopicCluster(id: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    const { error } = await supabase.from('topic_clusters').delete().eq('id', id);
    return error ? { success: false, error: error.message } : { success: true };
}

export async function createContentOpportunity(input: {
    organizationId: string; contentPlanId: string; topicClusterId?: string;
    opportunityType: ContentOpportunityType; workingTitle: string; keyword?: string;
    searchIntent?: SearchIntent; priority?: ContentPriority; existingUrl?: string;
    targetUrl?: string; notes?: string; dueDate?: string;
}): Promise<{ success: boolean; data?: ContentOpportunity; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    const { data, error } = await supabase.from('content_opportunities').insert({
        organization_id: input.organizationId,
        content_plan_id: input.contentPlanId,
        topic_cluster_id: input.topicClusterId || null,
        opportunity_type: input.opportunityType,
        working_title: input.workingTitle.trim(),
        keyword: input.keyword?.trim() || null,
        search_intent: input.searchIntent || null,
        priority: input.priority ?? 'medium',
        existing_url: input.existingUrl?.trim() || null,
        target_url: input.targetUrl?.trim() || null,
        notes: input.notes?.trim() || null,
        due_date: input.dueDate || null,
    }).select().single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToContentOpportunity(data) };
}

export async function updateContentOpportunity(
    id: string,
    patch: Partial<Pick<ContentOpportunity, 'topicClusterId' | 'opportunityType' | 'workingTitle' | 'keyword' | 'searchIntent' | 'status' | 'priority' | 'existingUrl' | 'targetUrl' | 'isQuestion' | 'assigneeId' | 'dueDate' | 'notes'>>,
): Promise<{ success: boolean; data?: ContentOpportunity; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    const keyMap: Record<string, string> = {
        topicClusterId: 'topic_cluster_id', opportunityType: 'opportunity_type', workingTitle: 'working_title',
        keyword: 'keyword', searchIntent: 'search_intent', status: 'status', priority: 'priority',
        existingUrl: 'existing_url', targetUrl: 'target_url', isQuestion: 'is_question',
        assigneeId: 'assignee_id', dueDate: 'due_date', notes: 'notes',
    };
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    Object.entries(patch).forEach(([key, value]) => { row[keyMap[key]] = value === '' ? null : value; });
    const { data, error } = await supabase.from('content_opportunities').update(row).eq('id', id).select().single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToContentOpportunity(data) };
}

export async function bulkUpdateOpportunityStatus(ids: string[], status: ContentOpportunityStatus): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    const { error } = await supabase.from('content_opportunities').update({ status, updated_at: new Date().toISOString() }).in('id', ids);
    return error ? { success: false, error: error.message } : { success: true };
}

export async function deleteContentOpportunity(id: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    const { error } = await supabase.from('content_opportunities').delete().eq('id', id);
    return error ? { success: false, error: error.message } : { success: true };
}

export async function promoteOpportunity(
    opportunity: ContentOpportunity,
    destination: 'task' | 'deliverable',
    clientId: string,
): Promise<{ success: boolean; recordId?: string; error?: string }> {
    if (opportunity.status !== 'approved') return { success: false, error: 'Approve this opportunity before promoting it.' };
    const sourceNote = `Content Plan source: ${opportunity.workingTitle}${opportunity.keyword ? `\nKeyword: ${opportunity.keyword}` : ''}${opportunity.searchIntent ? `\nIntent: ${opportunity.searchIntent}` : ''}${opportunity.targetUrl ? `\nTarget page: ${opportunity.targetUrl}` : ''}${opportunity.notes ? `\n\n${opportunity.notes}` : ''}`;
    let recordId: string | undefined;
    if (destination === 'task') {
        const result = await createTask({
            organizationId: opportunity.organizationId,
            clientId,
            title: opportunity.workingTitle,
            description: sourceNote,
            priority: opportunity.priority,
            assigneeIds: opportunity.assigneeId ? [opportunity.assigneeId] : undefined,
            dueDate: opportunity.dueDate,
        });
        if (!result.success || !result.data) return { success: false, error: result.error ?? 'Task creation failed' };
        recordId = result.data.id;
    } else {
        const subtype = opportunity.opportunityType === 'location_page' ? 'city_page'
            : opportunity.opportunityType === 'landing_page' ? 'landing_page'
            : opportunity.opportunityType === 'supporting_article' ? 'blog'
            : 'service_page';
        const result = await createDeliverable({
            organizationId: opportunity.organizationId,
            clientId,
            title: opportunity.workingTitle,
            type: 'Content', subtype, status: 'Pending', dueDate: opportunity.dueDate,
            assigneeId: opportunity.assigneeId, notes: sourceNote, countsTowardsHours: true,
        });
        if (!result.success || !result.data) return { success: false, error: result.error ?? 'Deliverable creation failed' };
        recordId = result.data.id;
    }
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    const { error } = await supabase.from('content_opportunities').update({
        status: 'promoted',
        task_id: destination === 'task' ? recordId : null,
        deliverable_id: destination === 'deliverable' ? recordId : null,
        updated_at: new Date().toISOString(),
    }).eq('id', opportunity.id);
    return error ? { success: false, error: error.message } : { success: true, recordId };
}

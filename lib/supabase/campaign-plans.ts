import { createClient } from './client';
import { createAdminClient } from './admin';
import {
    CampaignPlan, CampaignGoal, CampaignKpi,
    CampaignWorkstream, CampaignPhase, CampaignExpectation,
} from '../types';

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToPlan(r: any): CampaignPlan {
    return {
        id: r.id,
        organizationId: r.organization_id,
        clientId: r.client_id,
        status: r.status,
        title: r.title,
        summary: r.summary ?? undefined,
        strategyModel: r.strategy_model ?? undefined,
        startDate: r.start_date ?? undefined,
        targetReviewDate: r.target_review_date ?? undefined,
        createdById: r.created_by_id ?? undefined,
        approvedById: r.approved_by_id ?? undefined,
        approvedAt: r.approved_at ?? undefined,
        customFields: r.custom_fields ?? {},
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

function rowToGoal(r: any): CampaignGoal {
    return {
        id: r.id,
        campaignPlanId: r.campaign_plan_id,
        organizationId: r.organization_id,
        clientId: r.client_id,
        title: r.title,
        category: r.category ?? undefined,
        description: r.description ?? undefined,
        priority: r.priority ?? 0,
        ownerId: r.owner_id ?? undefined,
        status: r.status,
        sortOrder: r.sort_order ?? 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

function rowToKpi(r: any): CampaignKpi {
    return {
        id: r.id,
        campaignGoalId: r.campaign_goal_id ?? undefined,
        campaignPlanId: r.campaign_plan_id,
        organizationId: r.organization_id,
        clientId: r.client_id,
        metricName: r.metric_name,
        kpiGroup: r.kpi_group ?? undefined,
        source: r.source ?? undefined,
        baselineValue: r.baseline_value != null ? Number(r.baseline_value) : undefined,
        targetValue: r.target_value != null ? Number(r.target_value) : undefined,
        targetRangeMin: r.target_range_min != null ? Number(r.target_range_min) : undefined,
        targetRangeMax: r.target_range_max != null ? Number(r.target_range_max) : undefined,
        targetDate: r.target_date ?? undefined,
        cadence: r.cadence ?? undefined,
        confidence: r.confidence ?? undefined,
        measurementNotes: r.measurement_notes ?? undefined,
        sortOrder: r.sort_order ?? 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

function rowToWorkstream(r: any): CampaignWorkstream {
    return {
        id: r.id,
        campaignPlanId: r.campaign_plan_id,
        organizationId: r.organization_id,
        clientId: r.client_id,
        name: r.name,
        category: r.category ?? undefined,
        status: r.status,
        priority: r.priority ?? 0,
        ownerId: r.owner_id ?? undefined,
        currentState: r.current_state ?? undefined,
        targetState: r.target_state ?? undefined,
        risks: r.risks ?? undefined,
        customFields: r.custom_fields ?? {},
        sortOrder: r.sort_order ?? 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

function rowToPhase(r: any): CampaignPhase {
    return {
        id: r.id,
        campaignPlanId: r.campaign_plan_id,
        organizationId: r.organization_id,
        clientId: r.client_id,
        name: r.name,
        phaseOrder: r.phase_order,
        startDate: r.start_date ?? undefined,
        endDate: r.end_date ?? undefined,
        objective: r.objective ?? undefined,
        exitCriteria: r.exit_criteria ?? undefined,
        status: r.status,
        notes: r.notes ?? undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

function rowToExpectation(r: any): CampaignExpectation {
    return {
        id: r.id,
        campaignPlanId: r.campaign_plan_id,
        organizationId: r.organization_id,
        clientId: r.client_id,
        type: r.type ?? undefined,
        statement: r.statement,
        targetWindowDays: r.target_window_days ?? undefined,
        measurementDefinition: r.measurement_definition ?? undefined,
        confidence: r.confidence ?? undefined,
        preconditions: r.preconditions ?? undefined,
        exclusions: r.exclusions ?? undefined,
        reviewCheckpointDate: r.review_checkpoint_date ?? undefined,
        escalationRule: r.escalation_rule ?? undefined,
        approvedById: r.approved_by_id ?? undefined,
        approvedAt: r.approved_at ?? undefined,
        sortOrder: r.sort_order ?? 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

// ---------------------------------------------------------------------------
// Campaign Plan CRUD
// ---------------------------------------------------------------------------

export async function getCampaignPlan(clientId: string): Promise<CampaignPlan | null> {
    const supabase = createClient();
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('campaign_plans')
        .select('*')
        .eq('client_id', clientId)
        .neq('status', 'archived')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) { console.error('getCampaignPlan:', error); return null; }
    if (!data) return null;
    return rowToPlan(data);
}

export async function getCampaignPlanFull(clientId: string): Promise<CampaignPlan | null> {
    const plan = await getCampaignPlan(clientId);
    if (!plan) return null;
    const [goals, kpis, workstreams, phases, expectations] = await Promise.all([
        getCampaignGoals(plan.id),
        getCampaignKpis(plan.id),
        getCampaignWorkstreams(plan.id),
        getCampaignPhases(plan.id),
        getCampaignExpectations(plan.id),
    ]);
    return { ...plan, goals, kpis, workstreams, phases, expectations };
}

export async function createCampaignPlan(input: {
    organizationId: string;
    clientId: string;
    title: string;
    summary?: string;
    strategyModel?: string;
    startDate?: string;
    targetReviewDate?: string;
    createdById?: string;
}): Promise<{ success: boolean; data?: CampaignPlan; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const { data, error } = await supabase
        .from('campaign_plans')
        .insert({
            organization_id: input.organizationId,
            client_id: input.clientId,
            title: input.title,
            summary: input.summary ?? null,
            strategy_model: input.strategyModel ?? null,
            start_date: input.startDate ?? null,
            target_review_date: input.targetReviewDate ?? null,
            created_by_id: input.createdById ?? null,
        })
        .select()
        .single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToPlan(data) };
}

export async function updateCampaignPlan(
    planId: string,
    patch: Record<string, unknown>,
): Promise<{ success: boolean; data?: CampaignPlan; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const map: Record<string, string> = {
        title: 'title', summary: 'summary', status: 'status',
        strategyModel: 'strategy_model', startDate: 'start_date',
        targetReviewDate: 'target_review_date', approvedById: 'approved_by_id',
        approvedAt: 'approved_at', customFields: 'custom_fields',
    };
    for (const [k, v] of Object.entries(patch)) {
        if (map[k]) dbPatch[map[k]] = v;
    }
    const { data, error } = await supabase
        .from('campaign_plans')
        .update(dbPatch)
        .eq('id', planId)
        .select()
        .single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToPlan(data) };
}

// ---------------------------------------------------------------------------
// Goals CRUD
// ---------------------------------------------------------------------------

export async function getCampaignGoals(planId: string): Promise<CampaignGoal[]> {
    const supabase = createClient();
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('campaign_goals')
        .select('*')
        .eq('campaign_plan_id', planId)
        .order('sort_order', { ascending: true });
    if (error) { console.error('getCampaignGoals:', error); return []; }
    return (data ?? []).map(rowToGoal);
}

export async function upsertCampaignGoal(input: {
    id?: string;
    campaignPlanId: string;
    organizationId: string;
    clientId: string;
    title: string;
    category?: string;
    description?: string;
    priority?: number;
    ownerId?: string;
    status?: string;
    sortOrder?: number;
}): Promise<{ success: boolean; data?: CampaignGoal; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const row: Record<string, unknown> = {
        campaign_plan_id: input.campaignPlanId,
        organization_id: input.organizationId,
        client_id: input.clientId,
        title: input.title,
        category: input.category ?? null,
        description: input.description ?? null,
        priority: input.priority ?? 0,
        owner_id: input.ownerId ?? null,
        status: input.status ?? 'active',
        sort_order: input.sortOrder ?? 0,
        updated_at: new Date().toISOString(),
    };
    if (input.id) row.id = input.id;
    const { data, error } = await supabase
        .from('campaign_goals')
        .upsert(row)
        .select()
        .single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToGoal(data) };
}

export async function deleteCampaignGoal(goalId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const { error } = await supabase.from('campaign_goals').delete().eq('id', goalId);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

// ---------------------------------------------------------------------------
// KPIs CRUD
// ---------------------------------------------------------------------------

export async function getCampaignKpis(planId: string): Promise<CampaignKpi[]> {
    const supabase = createClient();
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('campaign_kpis')
        .select('*')
        .eq('campaign_plan_id', planId)
        .order('sort_order', { ascending: true });
    if (error) { console.error('getCampaignKpis:', error); return []; }
    return (data ?? []).map(rowToKpi);
}

export async function upsertCampaignKpi(input: {
    id?: string;
    campaignGoalId?: string;
    campaignPlanId: string;
    organizationId: string;
    clientId: string;
    metricName: string;
    kpiGroup?: string;
    source?: string;
    baselineValue?: number;
    targetValue?: number;
    targetRangeMin?: number;
    targetRangeMax?: number;
    targetDate?: string;
    cadence?: string;
    confidence?: string;
    measurementNotes?: string;
    sortOrder?: number;
}): Promise<{ success: boolean; data?: CampaignKpi; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const row: Record<string, unknown> = {
        campaign_goal_id: input.campaignGoalId ?? null,
        campaign_plan_id: input.campaignPlanId,
        organization_id: input.organizationId,
        client_id: input.clientId,
        metric_name: input.metricName,
        kpi_group: input.kpiGroup ?? null,
        source: input.source ?? null,
        baseline_value: input.baselineValue ?? null,
        target_value: input.targetValue ?? null,
        target_range_min: input.targetRangeMin ?? null,
        target_range_max: input.targetRangeMax ?? null,
        target_date: input.targetDate ?? null,
        cadence: input.cadence ?? 'monthly',
        confidence: input.confidence ?? 'medium',
        measurement_notes: input.measurementNotes ?? null,
        sort_order: input.sortOrder ?? 0,
        updated_at: new Date().toISOString(),
    };
    if (input.id) row.id = input.id;
    const { data, error } = await supabase
        .from('campaign_kpis')
        .upsert(row)
        .select()
        .single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToKpi(data) };
}

export async function deleteCampaignKpi(kpiId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const { error } = await supabase.from('campaign_kpis').delete().eq('id', kpiId);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

// ---------------------------------------------------------------------------
// Workstreams CRUD
// ---------------------------------------------------------------------------

export async function getCampaignWorkstreams(planId: string): Promise<CampaignWorkstream[]> {
    const supabase = createClient();
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('campaign_workstreams')
        .select('*')
        .eq('campaign_plan_id', planId)
        .order('sort_order', { ascending: true });
    if (error) { console.error('getCampaignWorkstreams:', error); return []; }
    return (data ?? []).map(rowToWorkstream);
}

export async function upsertCampaignWorkstream(input: {
    id?: string;
    campaignPlanId: string;
    organizationId: string;
    clientId: string;
    name: string;
    category?: string;
    status?: string;
    priority?: number;
    ownerId?: string;
    currentState?: string;
    targetState?: string;
    risks?: string;
    sortOrder?: number;
}): Promise<{ success: boolean; data?: CampaignWorkstream; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const row: Record<string, unknown> = {
        campaign_plan_id: input.campaignPlanId,
        organization_id: input.organizationId,
        client_id: input.clientId,
        name: input.name,
        category: input.category ?? null,
        status: input.status ?? 'planned',
        priority: input.priority ?? 0,
        owner_id: input.ownerId ?? null,
        current_state: input.currentState ?? null,
        target_state: input.targetState ?? null,
        risks: input.risks ?? null,
        sort_order: input.sortOrder ?? 0,
        updated_at: new Date().toISOString(),
    };
    if (input.id) row.id = input.id;
    const { data, error } = await supabase
        .from('campaign_workstreams')
        .upsert(row)
        .select()
        .single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToWorkstream(data) };
}

export async function deleteCampaignWorkstream(wsId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const { error } = await supabase.from('campaign_workstreams').delete().eq('id', wsId);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

// ---------------------------------------------------------------------------
// Phases CRUD
// ---------------------------------------------------------------------------

export async function getCampaignPhases(planId: string): Promise<CampaignPhase[]> {
    const supabase = createClient();
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('campaign_phases')
        .select('*')
        .eq('campaign_plan_id', planId)
        .order('phase_order', { ascending: true });
    if (error) { console.error('getCampaignPhases:', error); return []; }
    return (data ?? []).map(rowToPhase);
}

export async function upsertCampaignPhase(input: {
    id?: string;
    campaignPlanId: string;
    organizationId: string;
    clientId: string;
    name: string;
    phaseOrder?: number;
    startDate?: string;
    endDate?: string;
    objective?: string;
    exitCriteria?: string;
    status?: string;
    notes?: string;
}): Promise<{ success: boolean; data?: CampaignPhase; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const row: Record<string, unknown> = {
        campaign_plan_id: input.campaignPlanId,
        organization_id: input.organizationId,
        client_id: input.clientId,
        name: input.name,
        phase_order: input.phaseOrder ?? 0,
        start_date: input.startDate ?? null,
        end_date: input.endDate ?? null,
        objective: input.objective ?? null,
        exit_criteria: input.exitCriteria ?? null,
        status: input.status ?? 'upcoming',
        notes: input.notes ?? null,
        updated_at: new Date().toISOString(),
    };
    if (input.id) row.id = input.id;
    const { data, error } = await supabase
        .from('campaign_phases')
        .upsert(row)
        .select()
        .single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToPhase(data) };
}

export async function deleteCampaignPhase(phaseId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const { error } = await supabase.from('campaign_phases').delete().eq('id', phaseId);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

// ---------------------------------------------------------------------------
// Expectations CRUD
// ---------------------------------------------------------------------------

export async function getCampaignExpectations(planId: string): Promise<CampaignExpectation[]> {
    const supabase = createClient();
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('campaign_expectations')
        .select('*')
        .eq('campaign_plan_id', planId)
        .order('sort_order', { ascending: true });
    if (error) { console.error('getCampaignExpectations:', error); return []; }
    return (data ?? []).map(rowToExpectation);
}

export async function upsertCampaignExpectation(input: {
    id?: string;
    campaignPlanId: string;
    organizationId: string;
    clientId: string;
    type?: string;
    statement: string;
    targetWindowDays?: number;
    measurementDefinition?: string;
    confidence?: string;
    preconditions?: string;
    exclusions?: string;
    reviewCheckpointDate?: string;
    escalationRule?: string;
    sortOrder?: number;
}): Promise<{ success: boolean; data?: CampaignExpectation; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const row: Record<string, unknown> = {
        campaign_plan_id: input.campaignPlanId,
        organization_id: input.organizationId,
        client_id: input.clientId,
        type: input.type ?? null,
        statement: input.statement,
        target_window_days: input.targetWindowDays ?? null,
        measurement_definition: input.measurementDefinition ?? null,
        confidence: input.confidence ?? 'medium',
        preconditions: input.preconditions ?? null,
        exclusions: input.exclusions ?? null,
        review_checkpoint_date: input.reviewCheckpointDate ?? null,
        escalation_rule: input.escalationRule ?? null,
        sort_order: input.sortOrder ?? 0,
        updated_at: new Date().toISOString(),
    };
    if (input.id) row.id = input.id;
    const { data, error } = await supabase
        .from('campaign_expectations')
        .upsert(row)
        .select()
        .single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToExpectation(data) };
}

export async function deleteCampaignExpectation(expId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const { error } = await supabase.from('campaign_expectations').delete().eq('id', expId);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

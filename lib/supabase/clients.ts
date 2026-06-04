import { createClient } from './client';
import { ClientProject, ProjectStatus, EngagementModel, Tier } from '../types';
import { actualBlogsDueToDate, targetBlogCount } from '../seo-ops-logic';

// --- status mapping between the app's ProjectStatus and the DB's clients.status ---
const DB_TO_APP_STATUS: Record<string, ProjectStatus> = {
    active: 'Active',
    inactive: 'Cancelled',
    pending: 'Onboarding',
};
const APP_TO_DB_STATUS: Record<ProjectStatus, string> = {
    Active: 'active',
    Paused: 'pending',
    Onboarding: 'pending',
    Cancelled: 'inactive',
};

/** Map a Supabase clients row to the app's ClientProject shape. */
function rowToClientProject(row: any): ClientProject {
    const engagementModel: EngagementModel = (row.engagement_model as EngagementModel) || 'Retainer';
    const launchDate = row.launch_date || row.created_at || new Date().toISOString();
    const engagement = {
        engagementModel,
        blogsDuePerMonth: Number(row.blogs_due_per_month) || 0,
        launchDate: row.launch_date,
        launchDateOverride: row.launch_date_override,
        campaignTotalBlogs: row.campaign_total_blogs,
        deliverablesSpec: row.deliverables_spec,
    };
    const dueToDate = actualBlogsDueToDate(engagement);
    const target = row.target_blog_count ?? targetBlogCount(engagement);

    return {
        id: row.id,
        organizationId: row.organization_id,
        clientName: row.name,
        logoUrl: row.logo_url ?? undefined,
        launchDate,
        notes: row.notes ?? undefined,
        accountManager: row.account_manager_name || 'Unassigned',
        status: DB_TO_APP_STATUS[row.status] || 'Active',
        tier: (row.tier as Tier) || 1,
        engagementModel,
        seoHours: Number(row.seo_hours) || 0,
        deliverables: row.deliverables_spec || '',
        blogsDuePerMonth: Number(row.blogs_due_per_month) || 0,
        blogProgress: {
            target,
            dueToDate,
            delivered: row.delivered_override ?? 0, // exact count comes from the deliverables query
            pastDue: 0,
            override: row.delivered_override ?? undefined,
            isOnTrack: true,
        },
        approvals: { pendingCount: 0, items: [] },
        tasks: [],
        activeDeliverables: [],
        retainerConfig: {
            monthlyHours: Number(row.seo_hours) || 0,
            hoursUsed: 0,
            recurringDeliverables: [],
        },
    };
}

/** Map a partial ClientProject to a Supabase clients insert/update payload. */
function clientProjectToRow(client: Partial<ClientProject>) {
    return {
        organization_id: client.organizationId,
        name: client.clientName,
        launch_date: client.launchDate,
        seo_hours: client.seoHours,
        engagement_model: client.engagementModel,
        deliverables_spec: client.deliverables,
        blogs_due_per_month: client.blogsDuePerMonth,
        account_manager_name: client.accountManager,
        status: client.status ? APP_TO_DB_STATUS[client.status] : undefined,
        tier: client.tier,
        logo_url: client.logoUrl,
    };
}

export async function createClientProject(
    client: Partial<ClientProject>,
): Promise<{ success: boolean; data?: ClientProject; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };

    try {
        const { data, error } = await supabase
            .from('clients')
            .insert([clientProjectToRow(client)])
            .select()
            .single();

        if (error) throw error;
        return { success: true, data: rowToClientProject(data) };
    } catch (err: any) {
        console.error('Error creating client:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Fetch clients for an organization. Returns [] when Supabase is unavailable or
 * the org has no clients — no silent mock fallback, so empty/error states are real.
 */
export async function getClients(organizationId: string): Promise<ClientProject[]> {
    const supabase = createClient();
    if (!supabase) return [];

    try {
        const { data, error } = await supabase
            .from('clients')
            .select('*')
            .eq('organization_id', organizationId)
            .order('name', { ascending: true });

        if (error) throw error;
        return (data || []).map(rowToClientProject);
    } catch (err) {
        console.error('Error fetching clients:', err);
        return [];
    }
}

export async function updateClientProject(
    id: string,
    patch: Partial<ClientProject>,
): Promise<{ success: boolean; data?: ClientProject; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };

    try {
        const row = clientProjectToRow(patch);
        // strip undefined so we only update provided fields
        const payload = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
        const { data, error } = await supabase.from('clients').update(payload).eq('id', id).select().single();
        if (error) throw error;
        return { success: true, data: rowToClientProject(data) };
    } catch (err: any) {
        console.error('Error updating client:', err);
        return { success: false, error: err.message };
    }
}

export async function updateClientNotes(
    id: string,
    notes: string,
): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { error } = await supabase.from('clients').update({ notes }).eq('id', id);
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        console.error('Error updating client notes:', err);
        return { success: false, error: err.message };
    }
}

export async function createClients(
    clients: Omit<ClientProject, 'id' | 'blogProgress' | 'approvals' | 'tasks' | 'deliverables' | 'accountManager'>[],
): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };

    try {
        const { error } = await supabase.from('clients').insert(clients.map((c) => clientProjectToRow(c)));
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        console.error('Error creating clients:', err);
        return { success: false, error: err.message };
    }
}

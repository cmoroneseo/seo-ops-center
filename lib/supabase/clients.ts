import { createClient } from './client';
import { ClientProject, ProjectStatus, EngagementModel, Tier } from '../types';
import { actualBlogsDueToDate, targetBlogCount } from '../seo-ops-logic';
import { logActivity } from './client-activity';

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
    const launchDate: string | undefined = row.launch_date ?? undefined;
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
        domain: row.domain ?? undefined,
        logoUrl: row.logo_url ?? undefined,
        launchDate,
        notes: row.notes ?? undefined,
        accountManager: row.account_manager_name || 'Unassigned',
        accountManagerId: row.account_manager_id ?? undefined,
        campaignTotalBlogs: row.campaign_total_blogs ?? undefined,
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
        launch_date: client.launchDate || null,
        seo_hours: client.seoHours,
        engagement_model: client.engagementModel,
        deliverables_spec: client.deliverables,
        blogs_due_per_month: client.blogsDuePerMonth,
        account_manager_name: client.accountManager,
        account_manager_id: client.accountManagerId ?? null,
        campaign_total_blogs: client.campaignTotalBlogs ?? null,
        status: client.status ? APP_TO_DB_STATUS[client.status] : undefined,
        tier: client.tier,
        logo_url: client.logoUrl,
        domain: client.domain ?? undefined,
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
        const created = rowToClientProject(data);
        logActivity({
            clientId: created.id,
            eventType: 'client.created',
            metadata: { clientName: created.clientName, status: created.status, tier: created.tier },
        });
        return { success: true, data: created };
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

        // Capture prior status/tier so we can log what actually changed.
        let prev: { status?: ProjectStatus; tier?: Tier } = {};
        if (patch.status !== undefined || patch.tier !== undefined) {
            const { data: cur } = await supabase.from('clients').select('status, tier').eq('id', id).single();
            if (cur) prev = { status: DB_TO_APP_STATUS[cur.status] || 'Active', tier: (cur.tier as Tier) || 1 };
        }

        const { data, error } = await supabase.from('clients').update(payload).eq('id', id).select().single();
        if (error) throw error;
        const updated = rowToClientProject(data);

        if (patch.status !== undefined && prev.status !== updated.status) {
            logActivity({
                clientId: id,
                eventType: 'client.status_changed',
                metadata: { clientName: updated.clientName, fromStatus: prev.status, toStatus: updated.status },
            });
        }
        if (patch.tier !== undefined && prev.tier !== updated.tier) {
            logActivity({
                clientId: id,
                eventType: 'client.tier_changed',
                metadata: { clientName: updated.clientName, fromTier: prev.tier, toTier: updated.tier },
            });
        }

        return { success: true, data: updated };
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

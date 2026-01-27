import { createClient } from './client';
import { ClientProject } from '../types';
import { mockClients } from '../mock-data/workspace';

export async function createClientProject(client: Partial<ClientProject>): Promise<{ success: boolean; data?: ClientProject; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };

    try {
        const { data, error } = await supabase
            .from('clients')
            .insert([{
                organization_id: client.organizationId,
                name: client.clientName,
                launch_date: client.launchDate,
                seo_hours: client.seoHours,
                hour_type: client.hourType,
                blogs_per_month: client.blogsDuePerMonth,
                status: client.status,
                tier: client.tier
            }])
            .select()
            .single();

        if (error) throw error;

        return {
            success: true,
            data: {
                ...client,
                id: data.id,
            } as ClientProject
        };
    } catch (err: any) {
        console.error('Error creating client:', err);
        return { success: false, error: err.message };
    }
}

export async function getClients(organizationId: string): Promise<ClientProject[]> {
    const supabase = createClient();
    if (!supabase) {
        console.log('Supabase client not initialized, falling back to mock clients');
        return mockClients;
    }

    try {
        const { data, error } = await supabase
            .from('clients')
            .select('*')
            .eq('organization_id', organizationId);

        if (error) throw error;

        // If no clients found in DB, fallback to mock for demo purposes
        if (!data || data.length === 0) {
            console.log('No clients found in DB, falling back to mock clients');
            return mockClients;
        }

        // Map Supabase rows to ClientProject type
        return (data || []).map((row: any) => ({
            id: row.id,
            organizationId: row.organization_id,
            clientName: row.name,
            launchDate: row.created_at, // Placeholder
            seoHours: 0,
            hourType: 'Monthly',
            deliverables: '',
            blogsDuePerMonth: 0,
            accountManager: '',
            status: 'Active',
            tier: 1,
            blogProgress: { target: 0, dueToDate: 0, delivered: 0, pastDue: 0, isOnTrack: true },
            approvals: { pendingCount: 0, items: [] },
            tasks: []
        }));
    } catch (err) {
        console.error('Error fetching clients, falling back to mock clients:', err);
        return mockClients;
    }
}

export async function createClients(clients: Omit<ClientProject, 'id' | 'blogProgress' | 'approvals' | 'tasks' | 'deliverables' | 'accountManager'>[]): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };

    try {
        const { error } = await supabase
            .from('clients')
            .insert(clients.map(c => ({
                organization_id: c.organizationId,
                name: c.clientName,
                launch_date: c.launchDate,
                seo_hours: c.seoHours,
                hour_type: c.hourType,
                blogs_per_month: c.blogsDuePerMonth,
                status: c.status,
                tier: c.tier
            })));

        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        console.error('Error creating clients:', err);
        return { success: false, error: err.message };
    }
}

import { createClient } from './client';
import { OrganizationMember, User } from '../types';

export async function getOrganizationMembers(organizationId: string): Promise<(OrganizationMember & { user: User })[]> {
    const supabase = createClient();
    if (!supabase) return [];

    try {
        const { data, error } = await supabase
            .from('organization_members')
            .select(`
                *,
                user:users(*)
            `)
            .eq('organization_id', organizationId);

        if (error) throw error;

        return (data || []).map(m => ({
            id: m.id,
            organizationId: m.organization_id,
            userId: m.user_id,
            role: m.role,
            createdAt: m.created_at,
            user: {
                id: m.user.id,
                email: m.user.email,
                fullName: m.user.full_name,
                avatarUrl: m.user.avatar_url,
                systemRole: m.user.system_role
            }
        }));
    } catch (err) {
        console.error('Error fetching members:', err);
        return [];
    }
}

export async function addMemberByEmail(organizationId: string, email: string, role: string = 'member'): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };

    try {
        // 1. Find user by email in public.users
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return { success: false, error: 'User not found. They must sign up for an account first.' };
        }

        // 2. Check if already a member
        const { data: existing, error: existingError } = await supabase
            .from('organization_members')
            .select('id')
            .eq('organization_id', organizationId)
            .eq('user_id', user.id)
            .maybeSingle();

        if (existing) {
            return { success: false, error: 'User is already a member of this organization.' };
        }

        // 3. Add member
        const { error: insertError } = await supabase
            .from('organization_members')
            .insert([{
                organization_id: organizationId,
                user_id: user.id,
                role: role
            }]);

        if (insertError) throw insertError;

        return { success: true };
    } catch (err: any) {
        console.error('Error adding member:', err);
        return { success: false, error: err.message };
    }
}

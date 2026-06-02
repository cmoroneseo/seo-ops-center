import { createClient } from './client';
import { teamBonus } from '../seo-ops-logic';

export interface TeamBonusEntry {
    id: string;
    userId?: string;
    memberName?: string;
    month: string;
    baseFromHours: number;
    kpiBonus: number;
    cap: number;
    total: number; // computed = min(base + kpi, cap)
    notes?: string;
}

function rowToEntry(row: any): TeamBonusEntry {
    const baseFromHours = Number(row.base_from_hours) || 0;
    const kpiBonus = Number(row.kpi_bonus) || 0;
    const cap = Number(row.cap) ?? 300;
    return {
        id: row.id,
        userId: row.user_id ?? undefined,
        memberName: row.member_name ?? undefined,
        month: row.month,
        baseFromHours,
        kpiBonus,
        cap,
        total: teamBonus(baseFromHours, kpiBonus, cap),
        notes: row.notes ?? undefined,
    };
}

/**
 * Team bonus entries. RLS restricts this table to org owner/admin, so non-admin
 * callers get []. `total` is computed via teamBonus() (min(base + kpi, cap)).
 */
export async function getTeamBonus(organizationId: string, month?: string): Promise<TeamBonusEntry[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        let q = supabase.from('team_bonus').select('*').eq('organization_id', organizationId);
        if (month) q = q.eq('month', month);
        const { data, error } = await q.order('month', { ascending: false });
        if (error) throw error;
        return (data || []).map(rowToEntry);
    } catch (err) {
        console.error('Error fetching team bonus:', err);
        return [];
    }
}

export async function upsertTeamBonus(
    entry: { organizationId: string; userId?: string; memberName?: string; month: string; baseFromHours: number; kpiBonus: number; cap?: number; notes?: string },
): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { error } = await supabase.from('team_bonus').insert([{
            organization_id: entry.organizationId,
            user_id: entry.userId,
            member_name: entry.memberName,
            month: entry.month,
            base_from_hours: entry.baseFromHours,
            kpi_bonus: entry.kpiBonus,
            cap: entry.cap ?? 300,
            notes: entry.notes,
        }]);
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        console.error('Error saving team bonus:', err);
        return { success: false, error: err.message };
    }
}

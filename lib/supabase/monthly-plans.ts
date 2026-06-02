import { createClient } from './client';
import { MonthlyPlan, WeeklyPlan } from '../types';

function rowToMonthlyPlan(row: any): MonthlyPlan {
    const weeks: WeeklyPlan[] = (Array.isArray(row.weeks) ? row.weeks : []).map((w: any) => {
        const planned = Number(w.planned) || 0;
        const logged = Number(w.logged) || 0;
        return {
            weekNumber: w.week ?? w.weekNumber ?? 0,
            label: w.label || `W${w.week ?? w.weekNumber ?? ''}`,
            planned,
            logged,
            variance: w.variance != null ? Number(w.variance) : planned - logged,
        };
    });
    const totalPlanned = weeks.reduce((s, w) => s + w.planned, 0);
    const totalLogged = weeks.reduce((s, w) => s + w.logged, 0);
    return {
        id: row.id,
        clientId: row.client_id,
        month: row.month,
        weeks,
        totalPlanned,
        totalLogged,
        totalVariance: totalPlanned - totalLogged,
        notes: row.notes ?? undefined,
    };
}

/** Monthly plans for an org, optionally filtered by client and/or month. */
export async function getMonthlyPlans(
    organizationId: string,
    opts: { clientId?: string; month?: string } = {},
): Promise<MonthlyPlan[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        let q = supabase.from('monthly_plans').select('*').eq('organization_id', organizationId);
        if (opts.clientId) q = q.eq('client_id', opts.clientId);
        if (opts.month) q = q.eq('month', opts.month);
        const { data, error } = await q.order('month', { ascending: false });
        if (error) throw error;
        return (data || []).map(rowToMonthlyPlan);
    } catch (err) {
        console.error('Error fetching monthly plans:', err);
        return [];
    }
}

/** Create or update the plan for a client+month (planned hours per week). */
export async function upsertMonthlyPlan(
    plan: { organizationId: string; clientId: string; month: string; weeks: Partial<WeeklyPlan>[]; notes?: string },
): Promise<{ success: boolean; data?: MonthlyPlan; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const weeks = plan.weeks.map((w) => ({
            week: w.weekNumber,
            label: w.label,
            planned: w.planned ?? 0,
            logged: w.logged ?? null,
            variance: w.variance ?? null,
        }));
        const { data, error } = await supabase
            .from('monthly_plans')
            .upsert(
                { organization_id: plan.organizationId, client_id: plan.clientId, month: plan.month, weeks, notes: plan.notes },
                { onConflict: 'client_id,month' },
            )
            .select()
            .single();
        if (error) throw error;
        return { success: true, data: rowToMonthlyPlan(data) };
    } catch (err: any) {
        console.error('Error upserting monthly plan:', err);
        return { success: false, error: err.message };
    }
}

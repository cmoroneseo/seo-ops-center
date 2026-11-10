import { createClient } from './client';
import { newClientPlanItems, validateClientSetup, type ClientSetupInput } from '../client-setup';
import { phasePlanSteps } from '../seo-plan/plan-phases';

export async function createClientWithSetup(input: ClientSetupInput): Promise<{ id?: string; error?: string }> {
    const validation = validateClientSetup(input);
    if (validation) return { error: validation };
    const supabase = createClient();
    if (!supabase) return { error: 'Connection unavailable. Try again.' };
    const { data, error } = await supabase.rpc('create_client_with_setup', {
        p_request_id: input.requestId,
        p_organization_id: input.organizationId,
        p_name: input.name.trim(),
        p_domain: input.website.trim() || null,
        p_account_manager_id: input.accountManagerId || null,
        p_onboarding_date: input.onboardingDate,
        p_launch_date: input.launchDate || null,
        p_seo_hours: input.seoHours,
        p_scope: input.scope,
        p_steps: phasePlanSteps(),
        p_items: newClientPlanItems(),
    });
    return error ? { error: error.message } : { id: data as string };
}

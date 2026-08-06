import { createClient } from './client';
import { ClientIntelligence } from '../types';

export function rowToClientIntelligence(r: any): ClientIntelligence {
    return {
        id: r.id,
        organizationId: r.organization_id,
        clientId: r.client_id,
        status: r.status,
        version: r.version,
        business: r.business ?? {},
        offers: Array.isArray(r.offers) ? { items: r.offers } : (r.offers ?? { items: [] }),
        audiences: Array.isArray(r.audiences) ? { segments: r.audiences } : (r.audiences ?? { segments: [] }),
        markets: r.markets ?? {},
        seoContext: r.seo_context ?? {},
        brandConstraints: r.brand_constraints ?? {},
        createdBy: r.created_by ?? undefined,
        updatedBy: r.updated_by ?? undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

export async function getClientIntelligence(clientId: string): Promise<ClientIntelligence | null> {
    const supabase = createClient();
    if (!supabase) return null;
    const { data, error } = await supabase.from('client_intelligence').select('*').eq('client_id', clientId).maybeSingle();
    if (error) { console.error('getClientIntelligence:', error); return null; }
    return data ? rowToClientIntelligence(data) : null;
}

export async function saveClientIntelligence(input: {
    organizationId: string;
    clientId: string;
    profile?: ClientIntelligence | null;
    business: ClientIntelligence['business'];
    offers: ClientIntelligence['offers'];
    audiences: ClientIntelligence['audiences'];
    markets: ClientIntelligence['markets'];
    seoContext: ClientIntelligence['seoContext'];
    brandConstraints: ClientIntelligence['brandConstraints'];
    publish?: boolean;
    updatedBy?: string;
}): Promise<{ success: boolean; data?: ClientIntelligence; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    const version = input.publish && input.profile ? input.profile.version + 1 : input.profile?.version ?? 1;
    const row = {
        organization_id: input.organizationId,
        client_id: input.clientId,
        status: input.publish ? 'ready' : input.profile?.status ?? 'draft',
        version,
        business: input.business,
        offers: input.offers,
        audiences: input.audiences,
        markets: input.markets,
        seo_context: input.seoContext,
        brand_constraints: input.brandConstraints,
        updated_by: input.updatedBy ?? null,
        updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('client_intelligence').upsert(row, { onConflict: 'client_id' }).select().single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToClientIntelligence(data) };
}

export function clientIntelligenceReadiness(profile: Partial<ClientIntelligence> | null): number {
    if (!profile) return 0;
    const checks = [
        profile.business?.name, profile.business?.website, profile.business?.description,
        profile.business?.primaryConversion, profile.business?.differentiators,
        profile.offers?.items?.length, profile.audiences?.segments?.length, profile.markets?.locations,
        profile.seoContext?.competitors, profile.seoContext?.priorityThemes,
        profile.brandConstraints?.preferredTerminology, profile.brandConstraints?.prohibitedClaims,
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import type { TopicalMapProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) { return cookieStore.get(name)?.value; },
                set(name: string, value: string, options: CookieOptions) { cookieStore.set({ name, value, ...options }); },
                remove(name: string, options: CookieOptions) { cookieStore.set({ name, value: '', ...options }); },
            },
        },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { clientId, organizationId } = await req.json();
    if (!clientId || !organizationId) {
        return NextResponse.json({ error: 'clientId and organizationId required' }, { status: 400 });
    }

    const { data: clientCheck } = await supabase
        .from('clients')
        .select('id, organization_id, custom_fields, domain')
        .eq('id', clientId)
        .single();

    if (!clientCheck || clientCheck.organization_id !== organizationId) {
        return NextResponse.json({ error: 'Client not found or access denied' }, { status: 403 });
    }

    const admin = createAdminClient();

    // Stage 1: Profile
    const profileData = (clientCheck.custom_fields as Record<string, unknown>)?.topical_map_profile as Record<string, unknown> | undefined;
    if (!profileData) {
        return NextResponse.json({ error: 'Business profile not configured' }, { status: 400 });
    }

    const profile: TopicalMapProfile = {
        brandName: String(profileData.brand_name ?? ''),
        businessDescription: String(profileData.business_description ?? ''),
        contentLanguage: String(profileData.content_language ?? 'en'),
        focusTopics: (profileData.focus_topics as string[]) ?? [],
        rivals: (profileData.rivals as string[]) ?? [],
    };

    // Archive any existing active map
    await admin
        .from('topical_maps')
        .update({ status: 'archived', updated_at: new Date().toISOString() })
        .eq('client_id', clientId)
        .eq('organization_id', organizationId)
        .neq('status', 'archived');

    // Create new map in draft
    const { data: mapRow, error: mapError } = await admin
        .from('topical_maps')
        .insert({
            organization_id: organizationId,
            client_id: clientId,
            status: 'draft',
            title: `What ${profile.brandName} should own in search`,
            seed_input: { rivals: profile.rivals, focus_topics: profile.focusTopics },
            generation_metadata: { stages_completed: ['profile'] },
            created_by: user.id,
        })
        .select()
        .single();

    if (mapError || !mapRow) {
        return NextResponse.json({ error: mapError?.message ?? 'Failed to create map' }, { status: 500 });
    }
    const mapId = String(mapRow.id);

    // Stage 2: Search Demand (GSC) — just mark as done, data re-read by architect
    await admin.from('topical_maps').update({
        generation_metadata: { stages_completed: ['profile', 'search_demand'] },
    }).eq('id', mapId);

    // Stage 3: Your Pages — just mark as done, data re-read by architect
    await admin.from('topical_maps').update({
        generation_metadata: { stages_completed: ['profile', 'search_demand', 'your_pages'] },
    }).eq('id', mapId);

    return NextResponse.json({ success: true, mapId });
}

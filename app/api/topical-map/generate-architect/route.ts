import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, buildUserMessage } from '@/lib/topical-map/generate-prompt';
import { reconcileRecord } from '@/lib/topical-map/reconcile';
import type { TopicalMapProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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

    const { mapId } = await req.json();
    if (!mapId) {
        return NextResponse.json({ error: 'mapId required' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Load the map and verify ownership via RLS
    const { data: mapRow } = await supabase
        .from('topical_maps')
        .select('id, client_id, organization_id, generation_metadata')
        .eq('id', mapId)
        .single();

    if (!mapRow) {
        return NextResponse.json({ error: 'Map not found or access denied' }, { status: 404 });
    }

    const meta = mapRow.generation_metadata as Record<string, unknown> | null;
    const stages = (meta?.stages_completed ?? meta?.stagesCompleted ?? []) as string[];
    if (stages.includes('architect') || stages.includes('complete')) {
        return NextResponse.json({ error: 'Architect stage already completed' }, { status: 409 });
    }

    const clientId = String(mapRow.client_id);
    const organizationId = String(mapRow.organization_id);

    // Load client for profile + domain
    const { data: clientCheck } = await supabase
        .from('clients')
        .select('id, custom_fields, domain')
        .eq('id', clientId)
        .single();

    if (!clientCheck) {
        return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

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

    // Re-fetch GSC and pages (fast DB reads)
    const { data: gscRows } = await admin
        .from('gsc_search_performance')
        .select('query, clicks, impressions, position, page')
        .eq('client_id', clientId)
        .order('clicks', { ascending: false })
        .limit(50);

    const { data: pageSnapshots } = await admin
        .from('site_page_snapshots')
        .select('site_page_id, requested_url, title, h1s, word_count')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .order('observed_at', { ascending: false });

    const { data: pageUrls } = await admin
        .from('site_page_urls')
        .select('id, normalized_url, site_page_id')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId);

    const urlMap = new Map((pageUrls ?? []).map(u => [String(u.site_page_id), String(u.normalized_url)]));
    const existingPages = (pageSnapshots ?? []).map(s => ({
        pageId: String(s.site_page_id),
        normalizedUrl: urlMap.get(String(s.site_page_id)) ?? String(s.requested_url),
        url: urlMap.get(String(s.site_page_id)) ?? String(s.requested_url),
        title: s.title ? String(s.title) : undefined,
        h1s: (s.h1s as string[]) ?? [],
        wordCount: s.word_count != null ? Number(s.word_count) : undefined,
    }));

    // Stage 4: Architect (AI call)
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
    }
    const anthropic = new Anthropic({ apiKey, timeout: 120_000 });
    const ctx = {
        profile,
        existingPages: existingPages.map(p => ({ url: p.url, title: p.title, h1s: p.h1s, wordCount: p.wordCount })),
        gscQueries: (gscRows ?? []).map(r => ({
            query: String(r.query),
            clicks: Number(r.clicks),
            impressions: Number(r.impressions),
            position: Number(r.position),
        })),
        clientDomain: String(clientCheck.domain ?? ''),
    };

    const startTime = Date.now();

    const aiResponse = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: buildUserMessage(ctx) }],
    });

    const textBlock = aiResponse.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
        return NextResponse.json({ error: 'AI returned no text' }, { status: 500 });
    }

    let parsed: { architecture_summary: string; silos: Array<Record<string, unknown>> };
    try {
        const cleaned = textBlock.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(cleaned);
    } catch {
        return NextResponse.json({ error: 'AI returned invalid JSON' }, { status: 500 });
    }

    await admin.from('topical_maps').update({
        architecture_summary: parsed.architecture_summary,
        generation_metadata: {
            stages_completed: ['profile', 'search_demand', 'your_pages', 'architect'],
            model: aiResponse.model,
            tokens_used: (aiResponse.usage?.input_tokens ?? 0) + (aiResponse.usage?.output_tokens ?? 0),
        },
    }).eq('id', mapId);

    // Stage 5: Reconciliation — insert silos and records
    const gscEvidence = (gscRows ?? []).map(r => ({ query: String(r.query), pageUrl: String(r.page ?? '') }));

    for (let siloIdx = 0; siloIdx < parsed.silos.length; siloIdx++) {
        const silo = parsed.silos[siloIdx] as Record<string, unknown>;
        const records = (silo.records ?? []) as Array<Record<string, unknown>>;

        const { data: siloRow } = await admin
            .from('topical_map_silos')
            .insert({
                map_id: mapId,
                organization_id: organizationId,
                name: String(silo.name ?? ''),
                description: silo.description ? String(silo.description) : null,
                hub_url: silo.hub_url ? String(silo.hub_url) : null,
                search_intent: String(silo.search_intent ?? 'informational'),
                sort_order: siloIdx,
            })
            .select('id')
            .single();

        if (!siloRow) continue;
        const siloId = String(siloRow.id);

        const titleToId = new Map<string, string>();

        for (let recIdx = 0; recIdx < records.length; recIdx++) {
            const rec = records[recIdx];
            const reconciled = reconcileRecord(
                {
                    targetQuery: String(rec.target_query ?? ''),
                    title: String(rec.title ?? ''),
                    suggestedUrl: rec.suggested_url ? String(rec.suggested_url) : undefined,
                },
                existingPages,
                gscEvidence,
            );

            const parentTitle = rec.parent_title ? String(rec.parent_title) : undefined;
            const parentRecordId = parentTitle ? titleToId.get(parentTitle) : undefined;

            const { data: recordRow } = await admin
                .from('topical_map_records')
                .insert({
                    silo_id: siloId,
                    map_id: mapId,
                    organization_id: organizationId,
                    parent_record_id: parentRecordId ?? null,
                    page_type: String(rec.page_type ?? 'other'),
                    content_category: rec.content_category ? String(rec.content_category) : null,
                    action: reconciled.action,
                    title: String(rec.title ?? ''),
                    target_query: String(rec.target_query ?? ''),
                    word_count_min: Number(rec.word_count_min ?? 0),
                    word_count_max: Number(rec.word_count_max ?? 0),
                    build_phase: Number(rec.build_phase ?? 1),
                    search_volume_monthly: rec.search_volume_monthly != null ? Number(rec.search_volume_monthly) : null,
                    keyword_difficulty: rec.keyword_difficulty != null ? Number(rec.keyword_difficulty) : null,
                    scope_exclusions: rec.scope_exclusions ?? [],
                    outgoing_links: (rec.outgoing_links as Array<Record<string, unknown>> ?? []).map(l => ({
                        anchor_text: String(l.anchor_text ?? ''),
                        destination_url: '',
                        destination_title: String(l.destination_title ?? ''),
                    })),
                    site_page_id: reconciled.sitePageId ?? null,
                    matched_url: reconciled.matchedUrl ?? null,
                    sort_order: recIdx,
                })
                .select('id')
                .single();

            if (recordRow) titleToId.set(String(rec.title), String(recordRow.id));
        }
    }

    // Stage 6: Complete
    const durationMs = Date.now() - startTime;
    await admin.from('topical_maps').update({
        generation_metadata: {
            stages_completed: ['profile', 'search_demand', 'your_pages', 'architect', 'reconciliation', 'complete'],
            model: aiResponse.model,
            tokens_used: (aiResponse.usage?.input_tokens ?? 0) + (aiResponse.usage?.output_tokens ?? 0),
            duration_ms: durationMs,
            generated_at: new Date().toISOString(),
        },
    }).eq('id', mapId);

    return NextResponse.json({ success: true, mapId });
}

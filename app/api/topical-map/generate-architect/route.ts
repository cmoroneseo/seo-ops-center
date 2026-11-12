import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import Anthropic from '@anthropic-ai/sdk';
import { loadArchitectGscContext, loadArchitectPagePerformance } from '@/lib/topical-map/architect-gsc';
import { brandTokens, dedupeIdeas, GSC_MATCH_MAX_POSITION, intentKey } from '@/lib/topical-map/page-match';
import { queriesByPage, refreshCandidates } from '@/lib/topical-map/page-performance';
import { buildSystemPrompt, buildUserMessage } from '@/lib/topical-map/generate-prompt';
import { servicePageNames, validatePageMix } from '@/lib/topical-map/page-mix';
import { selectPromptPages } from '@/lib/topical-map/prompt-pages';
import { answerBriefFor, BRIEF_COLUMNS, briefToRow, insertSkippingMissingColumns } from '@/lib/topical-map/answer-brief';
import { seedKeywordsFromMap } from '@/lib/topical-map/seed-keywords';
import { architectStoredMetrics } from '@/lib/topical-map/metrics';
import { duplicateGateSummary, pageRefreshRead, reconcileRecord, type ReconcileContext } from '@/lib/topical-map/reconcile';
import type { SearchReportingAdmin } from '@/lib/search-reporting/load';
import type { TopicalMapProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    try {
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
        .select('id, client_id, organization_id, generation_metadata, seed_input')
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

    // Brand and domain words never make a match or a search group on their own.
    const ignoreTokens = brandTokens(profile.brandName, String(clientCheck.domain ?? ''));
    // Re-fetch GSC and pages (fast DB reads). Queries come from gsc_history_facts.
    const gscContext = await loadArchitectGscContext(admin as unknown as SearchReportingAdmin, {
        organizationId,
        clientId,
        ignoreTokens,
    });
    const { pageImpressions } = gscContext;
    // 180 stored days of page-grain facts for refresh signals. Runs during the
    // AI call and never rejects (a failed read gives no signals).
    const performancePromise = loadArchitectPagePerformance(admin as unknown as SearchReportingAdmin, {
        organizationId,
        clientId,
    });

    // Only the newest completed crawl: older runs still hold pages that were
    // since removed or renamed. With no completed run, every snapshot is read.
    const { data: latestRun } = await admin
        .from('site_crawl_runs')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
    let snapshotQuery = admin
        .from('site_page_snapshots')
        .select('site_page_id, requested_url, title, h1s, word_count, observed_at')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId);
    if (latestRun?.id) snapshotQuery = snapshotQuery.eq('run_id', String(latestRun.id));
    const { data: pageSnapshots } = await snapshotQuery.order('observed_at', { ascending: false });

    const { data: pageUrls } = await admin
        .from('site_page_urls')
        .select('id, normalized_url, site_page_id')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId);

    const urlMap = new Map((pageUrls ?? []).map(u => [String(u.site_page_id), String(u.normalized_url)]));
    // HTML pages with a title only, one per URL, most Search Console impressions first.
    const existingPages = selectPromptPages((pageSnapshots ?? []).map(s => ({
        pageId: String(s.site_page_id),
        url: urlMap.get(String(s.site_page_id)) ?? String(s.requested_url),
        title: s.title ? String(s.title) : undefined,
        h1s: (s.h1s as string[]) ?? [],
        wordCount: s.word_count != null ? Number(s.word_count) : undefined,
        observedAt: s.observed_at ? String(s.observed_at) : undefined,
    })), pageImpressions);

    // Stage 4: Architect (AI call)
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
    }
    // One 240s attempt fits inside maxDuration (300s) with ~60s left for the
    // DB reads before and the record inserts after. No SDK retries: a retry
    // after a timeout would be a second paid call that cannot finish in time.
    const anthropic = new Anthropic({ apiKey, timeout: 240_000, maxRetries: 0 });
    const ctx = {
        profile,
        existingPages: existingPages.map(p => ({ url: p.url, title: p.title, h1s: p.h1s, wordCount: p.wordCount })),
        gscQueries: gscContext.clusters,
        gscDays: gscContext.clusterDays,
        clientDomain: String(clientCheck.domain ?? ''),
        seedKeywords: seedKeywordsFromMap(mapRow.seed_input),
    };

    const startTime = Date.now();

    const aiResponse = await anthropic.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 16384,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: buildUserMessage(ctx) }],
    });

    const textBlock = aiResponse.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
        return NextResponse.json({ error: 'AI returned no text' }, { status: 500 });
    }

    if (aiResponse.stop_reason === 'max_tokens') {
        console.error('architect: AI response truncated (hit max_tokens). Output tokens:', aiResponse.usage?.output_tokens);
        return NextResponse.json({ error: 'AI response was truncated — try regenerating' }, { status: 500 });
    }

    let parsed: { architecture_summary: string; silos: Array<Record<string, unknown>> };
    try {
        const raw = textBlock.text;
        const jsonStart = raw.indexOf('{');
        const jsonEnd = raw.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1) {
            console.error('architect: no JSON braces found in AI response, first 500 chars:', raw.slice(0, 500));
            return NextResponse.json({ error: 'AI returned no JSON object' }, { status: 500 });
        }
        const jsonStr = raw.slice(jsonStart, jsonEnd + 1);
        parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
        console.error('architect: JSON parse failed:', parseErr instanceof Error ? parseErr.message : parseErr);
        console.error('architect: raw AI text (first 500 chars):', textBlock.text.slice(0, 500));
        console.error('architect: raw AI text (last 500 chars):', textBlock.text.slice(-500));
        console.error('architect: stop_reason:', aiResponse.stop_reason, 'output_tokens:', aiResponse.usage?.output_tokens);
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

    // Page mix: one idea per primary search, demand checked against Search
    // Console, articles and seed-only ideas trimmed to their caps.
    const rawRecords = parsed.silos.map(silo =>
        ((silo as Record<string, unknown>).records ?? (silo as Record<string, unknown>).pages ?? []) as Array<Record<string, unknown>>);
    let siloOffset = 0;
    const mixInput = rawRecords.flatMap(records => {
        const offset = siloOffset;
        siloOffset += records.length;
        return records.map((rec, i) => {
            // parent_title names a record in the same silo.
            const parent = rec.parent_title ? records.findIndex(other => String(other.title ?? '') === String(rec.parent_title)) : -1;
            return {
                pageType: rec.page_type,
                targetQuery: String(rec.target_query ?? ''),
                title: String(rec.title ?? ''),
                supportingQueries: Array.isArray(rec.supporting_queries)
                    ? rec.supporting_queries.filter((q): q is string => typeof q === 'string')
                    : undefined,
                demandQuery: typeof rec.demand_query === 'string' ? rec.demand_query : null,
                buildPhase: Number(rec.build_phase ?? 1),
                parentIndex: parent >= 0 && parent !== i ? offset + parent : null,
            };
        });
    });
    // Services they sell: the profile's focus topics plus the site's own service pages.
    const services = [...profile.focusTopics, ...servicePageNames(existingPages, ignoreTokens)];
    const pageMix = validatePageMix(mixInput, gscContext.clusters, ignoreTokens, { services });
    const mixByIndex = new Map(pageMix.kept.map(item => [item.index, item]));

    // Stage 5: Reconciliation — match every idea to existing pages, drop
    // duplicates across the whole map, then insert silos and records.
    // Only pairs that can match (spot 20 or better), each intent key computed once.
    const gscEvidence = gscContext.queryPages
        .filter(r => r.position <= GSC_MATCH_MAX_POSITION)
        .map(r => ({
            query: r.query,
            pageUrl: r.page,
            position: r.position,
            impressions: r.impressions,
            key: intentKey(r.query, ignoreTokens),
        }));
    const performance = await performancePromise;
    const reconcileCtx: ReconcileContext = {
        ignoreTokens,
        performance,
        pageQueries: queriesByPage(gscContext.queryPages),
        queryDays: gscContext.days,
        gscConnected: gscContext.days > 0 || performance.recentDays > 0,
    };

    let rawIdx = 0;
    const siloRecords = rawRecords.map(records => records.flatMap(rec => {
        const mix = mixByIndex.get(rawIdx++);
        if (!mix) return [];
        return [{
            rec,
            mix,
            reconciled: reconcileRecord(
                {
                    targetQuery: String(rec.target_query ?? ''),
                    title: String(rec.title ?? ''),
                    suggestedUrl: rec.suggested_url ? String(rec.suggested_url) : undefined,
                    supportingQueries: mix.supportingQueries,
                    pageType: mix.storedType,
                },
                existingPages,
                gscEvidence,
                reconcileCtx,
            ),
        }];
    }));
    const flat = siloRecords.flat();
    const { duplicateOf } = dedupeIdeas(
        flat.map(item => ({
            targetQuery: String(item.rec.target_query ?? ''),
            matchedUrl: item.reconciled.matchedUrl,
            // The stored type, so the same-type rule compares what is saved (not the model's raw page_type).
            pageType: item.mix.storedType,
        })),
        ignoreTokens,
    );
    const idByIndex = new Map<number, string>();
    // Record id per idea in the model's list (a dropped duplicate maps to the idea it duplicates).
    const idByMixIndex = new Map<number, string>();
    const refreshReasons: Record<string, { reason: string; signals: string[] }> = {};
    const mixRecords: Record<string, { page_type: string; seed_only: boolean; demand_query: string | null; demand_impressions: number | null }> = {};
    // Columns whose migration is not applied yet (083, 130): ideas save without them.
    const missingBriefColumns = new Set<string>();
    const briefCounts = { answers: 0, trimmed: 0, price_tables: 0 };
    let flatIdx = 0;

    for (let siloIdx = 0; siloIdx < parsed.silos.length; siloIdx++) {
        const silo = parsed.silos[siloIdx] as Record<string, unknown>;
        const records = siloRecords[siloIdx];
        const siloStart = flatIdx;
        flatIdx += records.length;
        // Nothing left to insert: the silo was empty or every idea in it was over a page-mix cap.
        if (records.length === 0) continue;

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

        for (let recIdx = 0; recIdx < records.length; recIdx++) {
            const { rec, mix, reconciled } = records[recIdx];
            const earlier = duplicateOf.get(siloStart + recIdx);
            if (earlier != null) {
                // Same search or same page as an earlier idea: not inserted.
                // Children that name it as parent attach to the earlier idea.
                const keptId = idByIndex.get(earlier);
                if (keptId) idByMixIndex.set(mix.index, keptId);
                continue;
            }

            // The page mix already moved children of trimmed ideas to the nearest kept ancestor.
            const parentRecordId = mix.parentIndex != null ? idByMixIndex.get(mix.parentIndex) : undefined;
            const metrics = architectStoredMetrics(rec);
            // Schema type and price table come from the page kind; the model only refines them.
            const { answerFirst60, brief } = answerBriefFor(rec, { kind: mix.kind, storedType: mix.storedType }, `${String(rec.title ?? '')} ${String(rec.target_query ?? '')}`);
            briefCounts.answers += answerFirst60 ? 1 : 0;
            briefCounts.trimmed += brief.answerTrimmed ? 1 : 0;
            briefCounts.price_tables += brief.priceTable ? 1 : 0;

            const { data: recordRow } = await insertSkippingMissingColumns<{ id: string }>(
                {
                    silo_id: siloId,
                    map_id: mapId,
                    organization_id: organizationId,
                    parent_record_id: parentRecordId ?? null,
                    page_type: mix.storedType,
                    content_category: mix.label,
                    action: reconciled.action,
                    title: String(rec.title ?? ''),
                    target_query: String(rec.target_query ?? ''),
                    word_count_min: Number(rec.word_count_min ?? 0),
                    word_count_max: Number(rec.word_count_max ?? 0),
                    build_phase: Number(rec.build_phase ?? 1),
                    search_volume_monthly: metrics.search_volume_monthly,
                    keyword_difficulty: metrics.keyword_difficulty,
                    scope_exclusions: rec.scope_exclusions ?? [],
                    outgoing_links: (rec.outgoing_links as Array<Record<string, unknown>> ?? []).map(l => ({
                        anchor_text: String(l.anchor_text ?? ''),
                        destination_url: '',
                        destination_title: String(l.destination_title ?? ''),
                    })),
                    site_page_id: reconciled.sitePageId ?? null,
                    matched_url: reconciled.matchedUrl ?? null,
                    sort_order: recIdx,
                    answer_first_60: answerFirst60,
                    answer_brief: briefToRow(brief),
                },
                BRIEF_COLUMNS,
                missingBriefColumns,
                row => admin.from('topical_map_records').insert(row).select('id').single(),
            );

            if (recordRow) {
                idByIndex.set(siloStart + recIdx, String(recordRow.id));
                idByMixIndex.set(mix.index, String(recordRow.id));
                if (reconciled.refresh) refreshReasons[String(recordRow.id)] = reconciled.refresh;
                mixRecords[String(recordRow.id)] = {
                    page_type: mix.kind,
                    seed_only: mix.seedOnly,
                    demand_query: mix.demand?.query ?? null,
                    demand_impressions: mix.demand?.impressions ?? null,
                };
            }
        }
    }

    // Existing pages with refresh signals that no idea matched, as Refresh
    // ideas in their own group. A page whose main search an idea already
    // targets is left to that idea.
    const kept = flat.filter((_, index) => !duplicateOf.has(index));
    const matchedUrls = new Set(kept.map(item => item.reconciled.matchedUrl).filter((url): url is string => Boolean(url)));
    const keptIntents = new Set(kept.map(item => intentKey(String(item.rec.target_query ?? ''), ignoreTokens)).filter(Boolean));
    const candidates = refreshCandidates(
        existingPages
            .map(page => ({
                url: page.normalizedUrl,
                pageId: page.pageId,
                title: page.title,
                read: pageRefreshRead(page.normalizedUrl, { wordCount: page.wordCount }, reconcileCtx),
            }))
            .filter(page => !page.read.numbers.query || !keptIntents.has(intentKey(page.read.numbers.query, ignoreTokens))),
        matchedUrls,
    );
    let refreshAdded = 0;
    if (candidates.length > 0) {
        const { data: refreshSilo } = await admin
            .from('topical_map_silos')
            .insert({
                map_id: mapId,
                organization_id: organizationId,
                name: 'Pages to refresh',
                description: 'Pages already on your site that are slipping in Google or could rank higher with an update.',
                hub_url: null,
                search_intent: 'commercial',
                sort_order: parsed.silos.length,
            })
            .select('id')
            .single();
        if (refreshSilo) {
            for (let i = 0; i < candidates.length; i++) {
                const candidate = candidates[i];
                const { data: recordRow } = await admin
                    .from('topical_map_records')
                    .insert({
                        silo_id: String(refreshSilo.id),
                        map_id: mapId,
                        organization_id: organizationId,
                        page_type: 'other',
                        action: 'improve',
                        title: candidate.title ?? candidate.url,
                        target_query: candidate.read.numbers.query ?? '',
                        build_phase: 1,
                        site_page_id: candidate.pageId ?? null,
                        matched_url: candidate.url,
                        sort_order: i,
                    })
                    .select('id')
                    .single();
                if (recordRow) {
                    refreshAdded += 1;
                    refreshReasons[String(recordRow.id)] = { reason: candidate.reason, signals: candidate.read.signals };
                }
            }
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
            duplicate_gate: duplicateGateSummary(flat.map(item => item.reconciled), duplicateOf.size, refreshAdded),
            refresh_reasons: refreshReasons,
            // Counts before PR 1's same-page gate; records holds every inserted idea.
            page_mix: { ...pageMix.summary, gsc_days: gscContext.clusterDays, records: mixRecords },
            answer_briefs: { ...briefCounts, columns_missing: [...missingBriefColumns] },
        },
    }).eq('id', mapId);

    return NextResponse.json({ success: true, mapId });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        const stack = err instanceof Error ? err.stack : '';
        console.error('generate-architect failed:', message, stack);
        return NextResponse.json({ error: message, stack }, { status: 500 });
    }
}

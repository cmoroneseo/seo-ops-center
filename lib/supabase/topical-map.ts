import { createClient } from './client';
import type {
    TopicalMap,
    TopicalMapSilo,
    TopicalMapRecord,
    TopicalMapProfile,
    MapScopeExclusion,
    MapOutgoingLink,
    TopicalMapStatus,
    PageType,
    MapRecordAction,
    MapRecordStatus,
    SearchIntent,
} from '../types';
import { createTask, type TaskInsert } from './tasks';

// ─── Row Mappers ────────────────────────────────────────────────────────────

export function rowToTopicalMap(row: Record<string, unknown>): TopicalMap {
    return {
        id: String(row.id),
        organizationId: String(row.organization_id),
        clientId: String(row.client_id),
        version: Number(row.version),
        status: row.status as TopicalMapStatus,
        title: String(row.title ?? ''),
        architectureSummary: row.architecture_summary ? String(row.architecture_summary) : undefined,
        seedInput: (row.seed_input as TopicalMap['seedInput']) ?? { rivals: [], focusTopics: [] },
        generationMetadata: (row.generation_metadata as TopicalMap['generationMetadata']) ?? {},
        createdBy: row.created_by ? String(row.created_by) : undefined,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
    };
}

export function rowToSilo(row: Record<string, unknown>): TopicalMapSilo {
    return {
        id: String(row.id),
        mapId: String(row.map_id),
        organizationId: String(row.organization_id),
        name: String(row.name),
        description: row.description ? String(row.description) : undefined,
        hubUrl: row.hub_url ? String(row.hub_url) : undefined,
        searchIntent: (row.search_intent as SearchIntent) ?? 'informational',
        sortOrder: Number(row.sort_order ?? 0),
    };
}

export function rowToRecord(row: Record<string, unknown>): TopicalMapRecord {
    return {
        id: String(row.id),
        siloId: String(row.silo_id),
        mapId: String(row.map_id),
        organizationId: String(row.organization_id),
        parentRecordId: row.parent_record_id ? String(row.parent_record_id) : undefined,
        pageType: (row.page_type as PageType) ?? 'other',
        contentCategory: row.content_category ? String(row.content_category) : undefined,
        action: (row.action as MapRecordAction) ?? 'create',
        title: String(row.title),
        targetQuery: String(row.target_query ?? ''),
        wordCountMin: Number(row.word_count_min ?? 0),
        wordCountMax: Number(row.word_count_max ?? 0),
        buildPhase: Number(row.build_phase ?? 1),
        refreshIntervalDays: row.refresh_interval_days != null ? Number(row.refresh_interval_days) : undefined,
        searchVolumeMonthly: row.search_volume_monthly != null ? Number(row.search_volume_monthly) : undefined,
        keywordDifficulty: row.keyword_difficulty != null ? Number(row.keyword_difficulty) : undefined,
        scopeExclusions: (row.scope_exclusions as MapScopeExclusion[]) ?? [],
        outgoingLinks: (row.outgoing_links as MapOutgoingLink[]) ?? [],
        status: (row.status as MapRecordStatus) ?? 'pending',
        sitePageId: row.site_page_id ? String(row.site_page_id) : undefined,
        matchedUrl: row.matched_url ? String(row.matched_url) : undefined,
        taskId: row.task_id ? String(row.task_id) : undefined,
        reviewerNotes: row.reviewer_notes ? String(row.reviewer_notes) : undefined,
        sortOrder: Number(row.sort_order ?? 0),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
    };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function getTopicalMap(mapId: string): Promise<TopicalMap | null> {
    const supabase = createClient();
    if (!supabase) return null;

    const { data } = await supabase
        .from('topical_maps')
        .select('*')
        .eq('id', mapId)
        .maybeSingle();

    return data ? rowToTopicalMap(data) : null;
}

export async function upsertTopicalMap(
    map: Partial<TopicalMap> & { organizationId: string; clientId: string },
): Promise<{ data: TopicalMap | null; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { data: null, error: 'Supabase not initialized' };

    const row: Record<string, unknown> = {
        organization_id: map.organizationId,
        client_id: map.clientId,
    };
    if (map.id !== undefined) row.id = map.id;
    if (map.version !== undefined) row.version = map.version;
    if (map.status !== undefined) row.status = map.status;
    if (map.title !== undefined) row.title = map.title;
    if (map.architectureSummary !== undefined) row.architecture_summary = map.architectureSummary;
    if (map.seedInput !== undefined) row.seed_input = map.seedInput;
    if (map.generationMetadata !== undefined) row.generation_metadata = map.generationMetadata;
    if (map.createdBy !== undefined) row.created_by = map.createdBy;
    row.updated_at = new Date().toISOString();

    const { data, error } = await supabase
        .from('topical_maps')
        .upsert(row)
        .select()
        .single();

    if (error) return { data: null, error: error.message };
    return { data: rowToTopicalMap(data) };
}

export async function createSilosAndRecords(
    silos: Array<Record<string, unknown>>,
    records: Array<Record<string, unknown>>,
): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };

    if (silos.length > 0) {
        const { error: siloError } = await supabase.from('topical_map_silos').insert(silos);
        if (siloError) return { success: false, error: siloError.message };
    }

    if (records.length > 0) {
        const { error: recordError } = await supabase.from('topical_map_records').insert(records);
        if (recordError) return { success: false, error: recordError.message };
    }

    return { success: true };
}

export async function getTopicalMapByClient(
    clientId: string,
): Promise<{ map: TopicalMap | null; silos: TopicalMapSilo[]; records: TopicalMapRecord[] }> {
    const supabase = createClient();
    if (!supabase) return { map: null, silos: [], records: [] };

    const { data: mapRow } = await supabase
        .from('topical_maps')
        .select('*')
        .eq('client_id', clientId)
        .neq('status', 'archived')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!mapRow) return { map: null, silos: [], records: [] };
    const map = rowToTopicalMap(mapRow);

    const [silosResult, recordsResult] = await Promise.all([
        supabase.from('topical_map_silos').select('*').eq('map_id', map.id).order('sort_order'),
        supabase.from('topical_map_records').select('*').eq('map_id', map.id).order('sort_order'),
    ]);

    return {
        map,
        silos: (silosResult.data ?? []).map(rowToSilo),
        records: (recordsResult.data ?? []).map(rowToRecord),
    };
}

export async function updateRecord(
    recordId: string,
    patch: Partial<Omit<TopicalMapRecord, 'id' | 'mapId' | 'organizationId' | 'createdAt'>>,
): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };

    const row: Record<string, unknown> = {};
    if (patch.siloId !== undefined) row.silo_id = patch.siloId;
    if (patch.parentRecordId !== undefined) row.parent_record_id = patch.parentRecordId;
    if (patch.pageType !== undefined) row.page_type = patch.pageType;
    if (patch.contentCategory !== undefined) row.content_category = patch.contentCategory;
    if (patch.action !== undefined) row.action = patch.action;
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.targetQuery !== undefined) row.target_query = patch.targetQuery;
    if (patch.wordCountMin !== undefined) row.word_count_min = patch.wordCountMin;
    if (patch.wordCountMax !== undefined) row.word_count_max = patch.wordCountMax;
    if (patch.buildPhase !== undefined) row.build_phase = patch.buildPhase;
    if (patch.refreshIntervalDays !== undefined) row.refresh_interval_days = patch.refreshIntervalDays;
    if (patch.searchVolumeMonthly !== undefined) row.search_volume_monthly = patch.searchVolumeMonthly;
    if (patch.keywordDifficulty !== undefined) row.keyword_difficulty = patch.keywordDifficulty;
    if (patch.scopeExclusions !== undefined) row.scope_exclusions = patch.scopeExclusions;
    if (patch.outgoingLinks !== undefined) row.outgoing_links = patch.outgoingLinks;
    if (patch.reviewerNotes !== undefined) row.reviewer_notes = patch.reviewerNotes;
    if (patch.status !== undefined) row.status = patch.status;
    row.updated_at = new Date().toISOString();

    const { error } = await supabase.from('topical_map_records').update(row).eq('id', recordId);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

export async function approveRecord(
    record: TopicalMapRecord,
    organizationId: string,
    clientId: string,
    userId?: string,
): Promise<{ success: boolean; taskId?: string; error?: string }> {
    const description = [
        `**Target Query:** ${record.targetQuery}`,
        `**Page Type:** ${record.pageType}`,
        record.contentCategory ? `**Category:** ${record.contentCategory}` : '',
        `**Word Count:** ${record.wordCountMin}–${record.wordCountMax}`,
        `**Build Phase:** ${record.buildPhase}`,
        record.refreshIntervalDays ? `**Refresh:** every ${record.refreshIntervalDays} days` : '',
        record.scopeExclusions.length > 0
            ? `**Stays out of:** ${record.scopeExclusions.map(e => e.url).join(', ')}`
            : '',
        record.outgoingLinks.length > 0
            ? `**Links out:** ${record.outgoingLinks.map(l => `${l.anchorText} → ${l.destinationUrl}`).join(', ')}`
            : '',
    ].filter(Boolean).join('\n');

    const taskResult = await createTask({
        organizationId,
        clientId,
        title: record.title,
        description,
        category: 'content',
        priority: 'medium',
        tags: [record.pageType, record.contentCategory].filter(Boolean) as string[],
        createdBy: userId,
    });

    if (!taskResult.success || !taskResult.data) {
        return { success: false, error: taskResult.error ?? 'Failed to create task' };
    }

    const updateResult = await updateRecord(record.id, {
        status: 'approved',
        taskId: taskResult.data.id,
    });

    if (!updateResult.success) {
        return { success: false, error: updateResult.error };
    }

    return { success: true, taskId: taskResult.data.id };
}

export async function declineRecord(recordId: string): Promise<{ success: boolean; error?: string }> {
    return updateRecord(recordId, { status: 'declined' });
}

// ─── Business Profile ───────────────────────────────────────────────────────

export async function getClientProfile(clientId: string): Promise<TopicalMapProfile | null> {
    const supabase = createClient();
    if (!supabase) return null;

    const { data } = await supabase
        .from('clients')
        .select('custom_fields')
        .eq('id', clientId)
        .single();

    const profile = (data?.custom_fields as Record<string, unknown>)?.topical_map_profile;
    if (!profile || typeof profile !== 'object') return null;

    const p = profile as Record<string, unknown>;
    return {
        brandName: String(p.brand_name ?? ''),
        businessDescription: String(p.business_description ?? ''),
        contentLanguage: String(p.content_language ?? 'en'),
        focusTopics: (p.focus_topics as string[]) ?? [],
        rivals: (p.rivals as string[]) ?? [],
        profileGeneratedAt: p.profile_generated_at ? String(p.profile_generated_at) : undefined,
    };
}

export async function saveClientProfile(
    clientId: string,
    profile: TopicalMapProfile,
): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };

    const { data: existing } = await supabase
        .from('clients')
        .select('custom_fields')
        .eq('id', clientId)
        .single();

    const customFields = (existing?.custom_fields as Record<string, unknown>) ?? {};
    customFields.topical_map_profile = {
        brand_name: profile.brandName,
        business_description: profile.businessDescription,
        content_language: profile.contentLanguage,
        focus_topics: profile.focusTopics,
        rivals: profile.rivals,
        profile_generated_at: new Date().toISOString(),
    };

    const { error } = await supabase
        .from('clients')
        .update({ custom_fields: customFields })
        .eq('id', clientId);

    if (error) return { success: false, error: error.message };
    return { success: true };
}

import { createClient } from '../supabase/client';
import { keywordTrackingEnabled } from './flag';
import {
    describeKeywordAdd,
    gscTargetInsert,
    keywordsChangedNote,
    keywordsChangedNoteInsert,
    planKeywordAdds,
    trackedKeywordCap,
    trackedKeywordInsert,
    type ExistingTrackedKeyword,
    type KeywordAddPlan,
    type KeywordScope,
    type KeywordSource,
    type PlannedKeyword,
} from './plan';

export interface KeywordTrackingStore {
    listKeywords(scope: KeywordScope): Promise<ExistingTrackedKeyword[]>;
    findLiveGscTarget(scope: KeywordScope): Promise<string | null>;
    insertGscTarget(scope: KeywordScope): Promise<string>;
    insertKeywords(scope: KeywordScope, targetId: string, keywords: PlannedKeyword[], source: KeywordSource): Promise<void>;
    reactivateKeywords(scope: KeywordScope, ids: string[], source: KeywordSource): Promise<void>;
    insertNote(scope: KeywordScope, targetId: string | null, body: string): Promise<void>;
}

export interface KeywordAddResult {
    ok: boolean;
    message: string;
    plan: KeywordAddPlan;
    wrote: boolean;
}

export interface RankingsKeyword {
    id: string;
    keyword: string;
    source: KeywordSource;
    createdAt: string;
}

export interface RankingsNote {
    id: string;
    kind: 'manual' | 'keywords_changed' | 'method_changed';
    body: string;
    createdAt: string;
}

export interface RankingsSnapshot {
    keywords: RankingsKeyword[];
    notes: RankingsNote[];
    cap: number;
    error?: string;
}

function emptyResult(message: string, ok: boolean): KeywordAddResult {
    return {
        ok,
        message,
        wrote: false,
        plan: {
            insert: [],
            reactivate: [],
            alreadyTracked: [],
            rejectedByCap: [],
            invalid: 0,
            duplicateCount: 0,
            cap: trackedKeywordCap(),
            activeCount: 0,
            seedGscTarget: false,
        },
    };
}

export async function applyKeywordAdds(
    store: KeywordTrackingStore,
    input: {
        scope: KeywordScope;
        entries: string[];
        source: Extract<KeywordSource, 'paste' | 'gsc_promote'>;
        cap?: number;
    },
): Promise<KeywordAddResult> {
    const existing = await store.listKeywords(input.scope);
    const liveTargetId = await store.findLiveGscTarget(input.scope);
    const plan = planKeywordAdds({
        entries: input.entries,
        existing,
        hasLiveGscTarget: liveTargetId != null,
        cap: input.cap,
    });
    const added = plan.insert.length + plan.reactivate.length;
    if (added === 0) {
        return { ok: true, message: describeKeywordAdd(plan), plan, wrote: false };
    }

    const targetId = plan.seedGscTarget ? await store.insertGscTarget(input.scope) : liveTargetId;
    if (plan.insert.length > 0) {
        if (!targetId) throw new Error('Missing GSC tracking target');
        await store.insertKeywords(input.scope, targetId, plan.insert, input.source);
    }
    if (plan.reactivate.length > 0) {
        await store.reactivateKeywords(input.scope, plan.reactivate.map(row => row.id), input.source);
    }
    const changed = [...plan.insert, ...plan.reactivate].map(row => row.keyword);
    await store.insertNote(input.scope, targetId, keywordsChangedNote(changed));
    return { ok: true, message: describeKeywordAdd(plan), plan, wrote: true };
}

export async function addTrackedKeywords(input: {
    organizationId: string;
    clientId: string;
    entries: string[];
    source: Extract<KeywordSource, 'paste' | 'gsc_promote'>;
    store?: KeywordTrackingStore;
}): Promise<KeywordAddResult> {
    if (!keywordTrackingEnabled()) return emptyResult('Keyword tracking is off.', false);
    if (!input.entries.some(entry => entry.trim())) return emptyResult('Enter at least one keyword.', false);
    try {
        const store = input.store ?? createSupabaseStore();
        if (!store) return emptyResult('Keyword tracking is unavailable.', false);
        return await applyKeywordAdds(store, {
            scope: { organizationId: input.organizationId, clientId: input.clientId },
            entries: input.entries,
            source: input.source,
        });
    } catch {
        console.error('Could not track keywords.');
        return emptyResult('Could not track those keywords.', false);
    }
}

export async function loadRankings(scope: KeywordScope): Promise<RankingsSnapshot> {
    const cap = trackedKeywordCap();
    if (!keywordTrackingEnabled()) return { keywords: [], notes: [], cap };
    const supabase = createClient();
    if (!supabase) return { keywords: [], notes: [], cap, error: 'Keyword tracking is unavailable.' };
    try {
        const [keywords, notes] = await Promise.all([
            supabase
                .from('tracked_keywords')
                .select('id, keyword, source, created_at')
                .eq('organization_id', scope.organizationId)
                .eq('client_id', scope.clientId)
                .eq('active', true)
                .order('created_at', { ascending: true }),
            supabase
                .from('tracking_notes')
                .select('id, kind, body, created_at')
                .eq('organization_id', scope.organizationId)
                .eq('client_id', scope.clientId)
                .order('created_at', { ascending: false })
                .limit(20),
        ]);
        if (keywords.error) throw keywords.error;
        if (notes.error) throw notes.error;
        return {
            cap,
            keywords: (keywords.data ?? []).map(rowToKeyword),
            notes: (notes.data ?? []).map(rowToNote),
        };
    } catch {
        console.error('Could not load tracked keywords.');
        return { keywords: [], notes: [], cap, error: 'Could not load tracked keywords.' };
    }
}

function rowToKeyword(row: { id: string; keyword: string; source: KeywordSource; created_at: string }): RankingsKeyword {
    return {
        id: row.id,
        keyword: row.keyword,
        source: row.source,
        createdAt: row.created_at,
    };
}

function rowToNote(row: { id: string; kind: RankingsNote['kind']; body: string; created_at: string }): RankingsNote {
    return {
        id: row.id,
        kind: row.kind,
        body: row.body,
        createdAt: row.created_at,
    };
}

function createSupabaseStore(): KeywordTrackingStore | null {
    const supabase = createClient();
    if (!supabase) return null;

    return {
        async listKeywords(scope) {
            const { data, error } = await supabase
                .from('tracked_keywords')
                .select('id, normalized_key, active')
                .eq('organization_id', scope.organizationId)
                .eq('client_id', scope.clientId);
            if (error) throw error;
            return (data ?? []).map((row: { id: string; normalized_key: string; active: boolean }) => ({
                id: row.id,
                normalizedKey: row.normalized_key,
                active: row.active,
            }));
        },
        async findLiveGscTarget(scope) {
            const { data, error } = await supabase
                .from('tracking_targets')
                .select('id')
                .eq('organization_id', scope.organizationId)
                .eq('client_id', scope.clientId)
                .eq('engine', 'gsc')
                .is('retired_at', null)
                .limit(1);
            if (error) throw error;
            const row = (data ?? [])[0] as { id: string } | undefined;
            return row?.id ?? null;
        },
        async insertGscTarget(scope) {
            const { data, error } = await supabase
                .from('tracking_targets')
                .insert(gscTargetInsert(scope))
                .select('id')
                .single();
            if (!error && data && typeof data.id === 'string') return data.id;
            if (error?.code === '23505') {
                const { data: existing, error: readError } = await supabase
                    .from('tracking_targets')
                    .select('id')
                    .eq('organization_id', scope.organizationId)
                    .eq('client_id', scope.clientId)
                    .eq('engine', 'gsc')
                    .is('retired_at', null)
                    .limit(1);
                if (readError) throw readError;
                const row = (existing ?? [])[0] as { id: string } | undefined;
                if (row?.id) return row.id;
            }
            throw error ?? new Error('Could not save the GSC target');
        },
        async insertKeywords(scope, targetId, keywords, source) {
            const rows = keywords.map(keyword => trackedKeywordInsert(scope, targetId, keyword, source));
            const { error } = await supabase.from('tracked_keywords').insert(rows);
            if (error) throw error;
        },
        async reactivateKeywords(scope, ids, source) {
            if (ids.length === 0) return;
            const { error } = await supabase
                .from('tracked_keywords')
                .update({ active: true, source, updated_at: new Date().toISOString() })
                .eq('organization_id', scope.organizationId)
                .eq('client_id', scope.clientId)
                .in('id', ids);
            if (error) throw error;
        },
        async insertNote(scope, targetId, body) {
            const { data } = await supabase.auth.getUser();
            const createdBy = data.user?.id ?? null;
            const first = await supabase
                .from('tracking_notes')
                .insert(keywordsChangedNoteInsert(scope, targetId, body, createdBy));
            if (!first.error) return;
            if (first.error.code === '23503' && createdBy) {
                const retry = await supabase
                    .from('tracking_notes')
                    .insert(keywordsChangedNoteInsert(scope, targetId, body, null));
                if (!retry.error) return;
                throw retry.error;
            }
            throw first.error;
        },
    };
}

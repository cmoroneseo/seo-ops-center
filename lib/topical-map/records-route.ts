import { contentWriterSpecEnabled } from '../content-writer/flags';
import { requireClientOrgMember } from '../security/tenant-authz';
import { createAdminClient } from '../supabase/admin';
import { rowToRecord } from '../supabase/topical-map';
import {
    manualInsertRow,
    parseManualRecord,
    parseSpecPatch,
    specColumnUpdates,
    type SpecFieldPatch,
} from './spec';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SiloContext {
    id: string;
    mapId: string;
    organizationId: string;
    clientId: string;
    archived: boolean;
}

export interface RecordContext {
    id: string;
    siloId: string;
    mapId: string;
    organizationId: string;
    clientId: string;
    wordCountMin: number;
    wordCountMax: number;
    archived: boolean;
}

export interface RecordWriteResult {
    row: Record<string, unknown> | null;
    missingColumn?: boolean;
}

export interface RecordsRouteDeps {
    enabled: (organizationId: string) => boolean;
    authorize: (clientId: unknown) => Promise<
        | { ok: true; organizationId: string; clientId: string; role: 'owner' | 'admin' | 'member' | 'viewer' }
        | { ok: false; status: number; error: string }
    >;
    loadSilo: (siloId: string) => Promise<SiloContext | null>;
    loadRecord: (recordId: string) => Promise<RecordContext | null>;
    nextSortOrder: (siloId: string) => Promise<number>;
    insertRecord: (row: Record<string, unknown>) => Promise<RecordWriteResult>;
    updateSpec: (recordId: string, organizationId: string, row: Record<string, unknown>) => Promise<RecordWriteResult>;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

async function readJson(request: Request): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false }> {
    try {
        const value = await request.json();
        if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false };
        return { ok: true, value: value as Record<string, unknown> };
    } catch {
        return { ok: false };
    }
}

function unavailable(result: RecordWriteResult): Response | null {
    if (result.missingColumn) {
        return json({ error: 'Apply migration 083 before using the spec drawer.' }, 503);
    }
    if (!result.row) return json({ error: 'Unable to save the record.' }, 500);
    return null;
}

function rangeConflict(patch: SpecFieldPatch, current?: { wordCountMin: number; wordCountMax: number }): string | null {
    const min = patch.wordCountMin !== undefined ? patch.wordCountMin : current && current.wordCountMin > 0 ? current.wordCountMin : null;
    const max = patch.wordCountMax !== undefined ? patch.wordCountMax : current && current.wordCountMax > 0 ? current.wordCountMax : null;
    if (min != null && max != null && min > max) return 'Word range minimum cannot be above the maximum.';
    return null;
}

export function createRecordsHandlers(deps: RecordsRouteDeps) {
    return {
        async get(request: Request) {
            const clientId = new URL(request.url).searchParams.get('clientId');
            const auth = await deps.authorize(clientId);
            if (!auth.ok) return json({ error: auth.error }, auth.status);
            return json({ enabled: deps.enabled(auth.organizationId) });
        },

        async post(request: Request) {
            const body = await readJson(request);
            if (!body.ok) return json({ error: 'Invalid request body' }, 400);
            const auth = await deps.authorize(body.value.clientId);
            if (!auth.ok) return json({ error: auth.error }, auth.status);
            if (!deps.enabled(auth.organizationId)) return json({ error: 'Not found' }, 404);
            if (auth.role === 'viewer') return json({ error: 'Viewer access is read-only' }, 403);

            const siloId = body.value.siloId;
            if (typeof siloId !== 'string' || !UUID.test(siloId)) return json({ error: 'Choose a silo.' }, 400);
            const parsed = parseManualRecord(body.value);
            if (!parsed.ok) return json({ error: parsed.error }, 400);

            const silo = await deps.loadSilo(siloId);
            if (!silo || silo.clientId !== auth.clientId || silo.organizationId !== auth.organizationId) {
                return json({ error: 'Silo not found' }, 404);
            }
            if (silo.archived) return json({ error: 'This topical map is archived.' }, 409);

            const sortOrder = await deps.nextSortOrder(silo.id);
            const row = manualInsertRow(parsed.draft, {
                siloId: silo.id,
                mapId: silo.mapId,
                organizationId: auth.organizationId,
                sortOrder,
            });
            const written = await deps.insertRecord(row);
            const failure = unavailable(written);
            if (failure) return failure;
            return json({ record: rowToRecord(written.row as Record<string, unknown>) });
        },

        async patch(request: Request) {
            const body = await readJson(request);
            if (!body.ok) return json({ error: 'Invalid request body' }, 400);
            const auth = await deps.authorize(body.value.clientId);
            if (!auth.ok) return json({ error: auth.error }, auth.status);
            if (!deps.enabled(auth.organizationId)) return json({ error: 'Not found' }, 404);
            if (auth.role === 'viewer') return json({ error: 'Viewer access is read-only' }, 403);

            const recordId = body.value.recordId;
            if (typeof recordId !== 'string' || !UUID.test(recordId)) return json({ error: 'Choose a record.' }, 400);
            const parsed = parseSpecPatch(body.value);
            if (!parsed.ok) return json({ error: parsed.error }, 400);

            const current = await deps.loadRecord(recordId);
            if (!current || current.clientId !== auth.clientId || current.organizationId !== auth.organizationId) {
                return json({ error: 'Record not found' }, 404);
            }
            if (current.archived) return json({ error: 'This topical map is archived.' }, 409);
            const conflict = rangeConflict(parsed.patch, current);
            if (conflict) return json({ error: conflict }, 400);

            const written = await deps.updateSpec(current.id, auth.organizationId, {
                ...specColumnUpdates(parsed.patch),
                updated_at: new Date().toISOString(),
            });
            const failure = unavailable(written);
            if (failure) return failure;
            return json({ record: rowToRecord(written.row as Record<string, unknown>) });
        },
    };
}

function missingColumn(error: { code?: string; message?: string } | null): boolean {
    if (!error) return false;
    return error.code === '42703' || error.code === 'PGRST204';
}

export function recordsRouteDeps(): RecordsRouteDeps {
    return {
        enabled: organizationId => contentWriterSpecEnabled(process.env, organizationId),
        authorize: clientId => requireClientOrgMember(clientId),
        loadSilo: async siloId => {
            const admin = createAdminClient();
            const { data: silo, error } = await admin
                .from('topical_map_silos')
                .select('id, map_id, organization_id')
                .eq('id', siloId)
                .maybeSingle();
            if (error || !silo) return null;
            const { data: map, error: mapError } = await admin
                .from('topical_maps')
                .select('id, client_id, organization_id, status')
                .eq('id', silo.map_id)
                .maybeSingle();
            if (mapError || !map) return null;
            return {
                id: String(silo.id),
                mapId: String(silo.map_id),
                organizationId: String(silo.organization_id),
                clientId: String(map.client_id),
                archived: map.status === 'archived',
            };
        },
        loadRecord: async recordId => {
            const admin = createAdminClient();
            const { data: record, error } = await admin
                .from('topical_map_records')
                .select('id, silo_id, map_id, organization_id, word_count_min, word_count_max')
                .eq('id', recordId)
                .maybeSingle();
            if (error || !record) return null;
            const { data: map, error: mapError } = await admin
                .from('topical_maps')
                .select('client_id, organization_id, status')
                .eq('id', record.map_id)
                .maybeSingle();
            if (mapError || !map) return null;
            return {
                id: String(record.id),
                siloId: String(record.silo_id),
                mapId: String(record.map_id),
                organizationId: String(record.organization_id),
                clientId: String(map.client_id),
                wordCountMin: Number(record.word_count_min ?? 0),
                wordCountMax: Number(record.word_count_max ?? 0),
                archived: map.status === 'archived',
            };
        },
        nextSortOrder: async siloId => {
            const admin = createAdminClient();
            const { data } = await admin
                .from('topical_map_records')
                .select('sort_order')
                .eq('silo_id', siloId)
                .order('sort_order', { ascending: false })
                .limit(1)
                .maybeSingle();
            return Number(data?.sort_order ?? -1) + 1;
        },
        insertRecord: async row => {
            const admin = createAdminClient();
            const { data, error } = await admin.from('topical_map_records').insert(row).select('*').single();
            if (error || !data) {
                console.error('[topical-map] record write failed');
                return { row: null, missingColumn: missingColumn(error) };
            }
            return { row: data };
        },
        updateSpec: async (recordId, organizationId, row) => {
            const admin = createAdminClient();
            const { data, error } = await admin
                .from('topical_map_records')
                .update(row)
                .eq('id', recordId)
                .eq('organization_id', organizationId)
                .select('*')
                .single();
            if (error || !data) {
                console.error('[topical-map] record write failed');
                return { row: null, missingColumn: missingColumn(error) };
            }
            return { row: data };
        },
    };
}

import { approvalTaskDescription } from '../topical-map/spec';
import {
    canMarkAlreadyLive,
    productionChoicePatch,
    productionUpdates,
    readProductionStatus,
    readWorkMonth,
    type MapProduction,
} from '../topical-map/production';
import { approvalUpdate, planRecordApproval } from './approve';
import { CONTENT_READ_ONLY, canEditContent } from './access';
import { requireClientOrgMember } from '../security/tenant-authz';
import { createAdminClient } from '../supabase/admin';
import { logClientActivity } from '../supabase/client-activity';
import { MISSING_PRODUCTION_COLUMN, rowToRecord } from '../supabase/topical-map';
import { taskCreateRow } from '../tasks/create-row';
import type { ProductionStatus, TopicalMapRecord } from '../types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ContentRecordContext {
    record: TopicalMapRecord;
    clientId: string;
    organizationId: string;
    archived: boolean;
}

export interface ContentTaskDraft {
    organizationId: string;
    clientId: string;
    userId: string;
    actorName: string;
    record: TopicalMapRecord;
}

export interface ContentWriteResult {
    row: Record<string, unknown> | null;
    missingColumn?: boolean;
}

export interface ContentRouteDeps {
    authorize: (clientId: unknown) => Promise<
        | { ok: true; userId: string; actorName: string; organizationId: string; clientId: string; role: 'owner' | 'admin' | 'member' | 'viewer' }
        | { ok: false; status: number; error: string }
    >;
    loadRecord: (recordId: string) => Promise<ContentRecordContext | null>;
    updateRecord: (recordId: string, organizationId: string, row: Record<string, unknown>) => Promise<ContentWriteResult>;
    createTask: (draft: ContentTaskDraft) => Promise<{ ok: true; taskId: string } | { ok: false; error: string }>;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
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

function unavailable(result: ContentWriteResult): Response | null {
    if (result.missingColumn) return json({ error: MISSING_PRODUCTION_COLUMN }, 503);
    if (!result.row) return json({ error: 'Could not save this page.' }, 500);
    return null;
}

export function contentChangeRow(
    record: TopicalMapRecord,
    patch: Partial<MapProduction>,
): { ok: true; row: Record<string, string | null> } | { ok: false; error: string } {
    const production: Partial<MapProduction> = {};
    let planStatus: TopicalMapRecord['status'] | undefined;
    if (patch.productionStatus !== undefined) {
        const status = readProductionStatus(patch.productionStatus);
        if (!status) return { ok: false, error: 'Choose a status from the list.' };
        if (status === 'already_live' && !canMarkAlreadyLive(record)) {
            return { ok: false, error: 'This page is not already on the site.' };
        }
        const choice = productionChoicePatch(status);
        production.productionStatus = choice.productionStatus;
        planStatus = choice.status;
    }
    if (patch.workMonth !== undefined) production.workMonth = patch.workMonth;
    if (patch.dueDate !== undefined) production.dueDate = patch.dueDate;
    if (patch.publishedOn !== undefined) production.publishedOn = patch.publishedOn;
    if (patch.draftUrl !== undefined) production.draftUrl = patch.draftUrl;
    if (patch.liveUrl !== undefined) production.liveUrl = patch.liveUrl;
    if (Object.keys(production).length === 0) return { ok: false, error: 'Choose a status or a month.' };
    const written = productionUpdates(production);
    if (!written.ok) return written;
    return { ok: true, row: { ...written.row, ...(planStatus ? { status: planStatus } : {}) } };
}

function productionPatch(value: Record<string, unknown>): Partial<MapProduction> {
    const patch: Partial<MapProduction> = {};
    if ('productionStatus' in value) patch.productionStatus = value.productionStatus as ProductionStatus | null;
    if ('workMonth' in value) patch.workMonth = value.workMonth as string | null;
    if ('dueDate' in value) patch.dueDate = value.dueDate as string | null;
    if ('publishedOn' in value) patch.publishedOn = value.publishedOn as string | null;
    if ('draftUrl' in value) patch.draftUrl = value.draftUrl as string | null;
    if ('liveUrl' in value) patch.liveUrl = value.liveUrl as string | null;
    return patch;
}

async function authorizedRecord(deps: ContentRouteDeps, clientId: unknown, recordId: unknown) {
    const auth = await deps.authorize(clientId);
    if (!auth.ok) return { response: json({ error: auth.error }, auth.status) };
    if (!canEditContent(auth.role)) return { response: json({ error: CONTENT_READ_ONLY }, 403) };
    if (typeof recordId !== 'string' || !UUID.test(recordId)) return { response: json({ error: 'Choose a page.' }, 400) };
    const current = await deps.loadRecord(recordId);
    if (!current || current.clientId !== auth.clientId || current.organizationId !== auth.organizationId) {
        return { response: json({ error: 'That page was not found.' }, 404) };
    }
    if (current.archived) return { response: json({ error: 'This topic map is archived.' }, 409) };
    return { auth, current };
}

export function createContentHandlers(deps: ContentRouteDeps) {
    return {
        async approve(request: Request) {
            const body = await readJson(request);
            if (!body.ok) return json({ error: 'Check the form and try again.' }, 400);
            const gate = await authorizedRecord(deps, body.value.clientId, body.value.recordId);
            if ('response' in gate && gate.response) return gate.response;
            if (!('current' in gate)) return json({ error: 'Could not save this page.' }, 500);
            const { auth, current } = gate;

            const month = readWorkMonth(typeof body.value.workMonth === 'string' ? body.value.workMonth : '');
            if (!month) return json({ error: 'Month needs a real month.' }, 400);
            const plan = planRecordApproval(current.record);

            let taskId = plan.taskId;
            if (plan.createTask) {
                const created = await deps.createTask({
                    organizationId: auth.organizationId,
                    clientId: auth.clientId,
                    userId: auth.userId,
                    actorName: auth.actorName,
                    record: current.record,
                });
                if (!created.ok) return json({ error: created.error }, 500);
                taskId = created.taskId;
            }
            const written = approvalUpdate(current.record, taskId ?? '', month);
            if (!written.ok) return json({ error: written.error }, 400);
            const saved = await deps.updateRecord(current.record.id, auth.organizationId, {
                ...written.row,
                updated_at: new Date().toISOString(),
            });
            const failure = unavailable(saved);
            if (failure) return failure;
            return json({ record: rowToRecord(saved.row as Record<string, unknown>), taskId });
        },

        async update(request: Request) {
            const body = await readJson(request);
            if (!body.ok) return json({ error: 'Check the form and try again.' }, 400);
            const gate = await authorizedRecord(deps, body.value.clientId, body.value.recordId);
            if ('response' in gate && gate.response) return gate.response;
            if (!('current' in gate)) return json({ error: 'Could not save this page.' }, 500);
            const { auth, current } = gate;
            const written = contentChangeRow(current.record, productionPatch(body.value));
            if (!written.ok) return json({ error: written.error }, 400);
            const saved = await deps.updateRecord(current.record.id, auth.organizationId, {
                ...written.row,
                updated_at: new Date().toISOString(),
            });
            const failure = unavailable(saved);
            if (failure) return failure;
            return json({ record: rowToRecord(saved.row as Record<string, unknown>) });
        },
    };
}

function missingColumn(error: { code?: string; message?: string } | null): boolean {
    if (!error) return false;
    return error.code === '42703' || error.code === 'PGRST204';
}

export function contentRouteDeps(): ContentRouteDeps {
    return {
        authorize: clientId => requireClientOrgMember(clientId),
        loadRecord: async recordId => {
            const admin = createAdminClient();
            const { data, error } = await admin.from('topical_map_records').select('*').eq('id', recordId).maybeSingle();
            if (error || !data) return null;
            const { data: map, error: mapError } = await admin
                .from('topical_maps')
                .select('client_id, organization_id, status')
                .eq('id', data.map_id)
                .maybeSingle();
            if (mapError || !map) return null;
            return {
                record: rowToRecord(data),
                clientId: String(map.client_id),
                organizationId: String(map.organization_id),
                archived: map.status === 'archived',
            };
        },
        updateRecord: async (recordId, organizationId, row) => {
            const admin = createAdminClient();
            const { data, error } = await admin
                .from('topical_map_records')
                .update(row)
                .eq('id', recordId)
                .eq('organization_id', organizationId)
                .select('*')
                .single();
            if (error || !data) {
                console.error('[content] page save failed');
                return { row: null, missingColumn: missingColumn(error) };
            }
            return { row: data };
        },
        createTask: async draft => {
            const admin = createAdminClient();
            const row = {
                ...taskCreateRow({
                    organizationId: draft.organizationId,
                    clientId: draft.clientId,
                    title: draft.record.title,
                    description: approvalTaskDescription(draft.record),
                    category: 'content',
                    priority: 'medium',
                    tags: [draft.record.pageType, draft.record.contentCategory].filter(Boolean) as string[],
                    createdBy: draft.userId,
                }),
                status_history: [{ status: 'todo', at: new Date().toISOString(), by: draft.userId }],
            };
            const { data, error } = await admin.from('tasks').insert(row).select('id').single();
            if (error || !data?.id) {
                console.error('[content] task create failed');
                return { ok: false, error: 'Could not create the task for this page.' };
            }
            void logClientActivity({
                organizationId: draft.organizationId,
                clientId: draft.clientId,
                eventType: 'task.created',
                actorId: draft.userId,
                actorName: draft.actorName,
                metadata: { taskId: String(data.id), title: draft.record.title, category: 'content' },
            }).catch(() => undefined);
            return { ok: true, taskId: String(data.id) };
        },
    };
}

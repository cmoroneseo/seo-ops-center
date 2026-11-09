/**
 * Staff read and write for the Campaign Work content plan.
 *
 * The browser client is the user client. RLS and the scope trigger are the
 * server-side boundary. organization_id is taken from the client row the
 * user can read. An organization id asserted by the form is accepted only
 * when it matches that row. This store does not read or write roadmap
 * initiatives, the strategy document, or the monthly board.
 */

import { createClient } from './client';
import {
    contentPlanInsertRow,
    contentPlanUpdateRow,
    contentPlanWriteScope,
    normalizeContentPlanDraft,
    readContentPlanRow,
    type ContentPlanDraft,
    type ContentPlanRow,
} from '../campaign-workspace/content-plan';

export interface ContentPlanRead {
    rows: ContentPlanRow[];
    unavailable: boolean;
}

function rows(data: unknown): Record<string, unknown>[] {
    if (!Array.isArray(data)) return [];
    return data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
}

function mapRows(data: unknown): ContentPlanRow[] {
    return rows(data).flatMap(row => {
        const mapped = readContentPlanRow(row);
        return mapped ? [mapped] : [];
    });
}

export async function listCampaignContentPlan(clientId: string, planMonth: string): Promise<ContentPlanRead> {
    const supabase = createClient();
    if (!supabase || !clientId || !planMonth) return { rows: [], unavailable: true };
    try {
        const result = await supabase
            .from('campaign_content_plan')
            .select('*')
            .eq('client_id', clientId)
            .eq('plan_month', planMonth)
            .order('created_at', { ascending: true });
        if (result.error) {
            console.error('[campaign-content-plan] list', result.error);
            return { rows: [], unavailable: true };
        }
        return { rows: mapRows(result.data), unavailable: false };
    } catch (error) {
        console.error('[campaign-content-plan] list', error);
        return { rows: [], unavailable: true };
    }
}

async function resolveScope(
    supabase: NonNullable<ReturnType<typeof createClient>>,
    clientId: string,
    assertedOrganizationId: string | null | undefined,
) {
    const { data, error } = await supabase
        .from('clients')
        .select('id, organization_id')
        .eq('id', clientId)
        .maybeSingle();
    if (error) {
        console.error('[campaign-content-plan] client', error);
        return contentPlanWriteScope({ client: null });
    }
    const record = data as { id?: unknown; organization_id?: unknown } | null;
    const client = record && typeof record.id === 'string' && typeof record.organization_id === 'string'
        && record.id === clientId
        ? { id: record.id, organizationId: record.organization_id }
        : null;
    return contentPlanWriteScope({ client, assertedOrganizationId });
}

function savedRow(data: unknown): ContentPlanRow {
    const row = data && typeof data === 'object' ? readContentPlanRow(data as Record<string, unknown>) : null;
    if (!row) throw new Error('Could not save this content.');
    return row;
}

export async function createCampaignContentPlanRow(input: {
    clientId: string;
    assertedOrganizationId?: string | null;
    planMonth: string;
    draft: ContentPlanDraft;
}): Promise<ContentPlanRow> {
    const normalized = normalizeContentPlanDraft(input.draft);
    if (!normalized.ok) throw new Error(normalized.error);
    const supabase = createClient();
    if (!supabase) throw new Error('Sign in to save content.');
    const scope = await resolveScope(supabase, input.clientId, input.assertedOrganizationId);
    if (!scope.ok) throw new Error(scope.error);
    let row: Record<string, string | number | null>;
    try {
        row = contentPlanInsertRow(scope, input.planMonth, normalized.value);
    } catch (error) {
        throw new Error(error instanceof Error ? error.message : 'Month is not a work month.');
    }
    const inserted = await supabase.from('campaign_content_plan').insert(row).select('*').single();
    if (inserted.error) {
        console.error('[campaign-content-plan] insert', inserted.error);
        throw new Error('Could not save this content.');
    }
    return savedRow(inserted.data);
}

export async function updateCampaignContentPlanRow(input: {
    clientId: string;
    assertedOrganizationId?: string | null;
    id: string;
    draft: ContentPlanDraft;
}): Promise<ContentPlanRow> {
    const id = input.id.trim();
    if (!id) throw new Error('This content is not on this client.');
    const normalized = normalizeContentPlanDraft(input.draft);
    if (!normalized.ok) throw new Error(normalized.error);
    const supabase = createClient();
    if (!supabase) throw new Error('Sign in to save content.');
    const scope = await resolveScope(supabase, input.clientId, input.assertedOrganizationId);
    if (!scope.ok) throw new Error(scope.error);
    const updated = await supabase
        .from('campaign_content_plan')
        .update(contentPlanUpdateRow(normalized.value))
        .eq('id', id)
        .eq('client_id', scope.clientId)
        .select('*')
        .maybeSingle();
    if (updated.error) {
        console.error('[campaign-content-plan] update', updated.error);
        throw new Error('Could not save this content.');
    }
    const row = savedRow(updated.data);
    if (row.id !== id || row.clientId !== scope.clientId) throw new Error('This content is not on this client.');
    return row;
}

export async function deleteCampaignContentPlanRow(input: {
    clientId: string;
    id: string;
}): Promise<void> {
    const id = input.id.trim();
    if (!id) throw new Error('This content is not on this client.');
    const supabase = createClient();
    if (!supabase) throw new Error('Sign in to save content.');
    const deleted = await supabase
        .from('campaign_content_plan')
        .delete()
        .eq('id', id)
        .eq('client_id', input.clientId)
        .select('id');
    if (deleted.error) {
        console.error('[campaign-content-plan] delete', deleted.error);
        throw new Error('Could not remove this content.');
    }
    const removed = rows(deleted.data).some(row => row.id === id);
    if (!removed) throw new Error('This content is not on this client.');
}

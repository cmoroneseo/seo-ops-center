/**
 * Staff read and write for campaign initiatives.
 *
 * The browser client is the user client. RLS and the scope trigger are the
 * server-side boundary. organization_id is taken from the client row the
 * user can read, never from a role or an organization id the form asserts
 * when that id does not match the client.
 */

import { createClient } from './client';
import {
    initiativeItemRow,
    initiativeRow,
    initiativeWriteScope,
    normalizeInitiativeDraft,
    readInitiativeStory,
    safeHttpUrl,
    type CampaignInitiative,
    type ContentState,
    type InitiativeDraft,
    type InitiativeItem,
    type InitiativePriority,
    type InitiativeState,
    type InitiativeWrite,
} from '../campaign-workspace/initiatives';

export interface InitiativeRead {
    initiatives: CampaignInitiative[];
    unavailable: boolean;
}

const STATES = new Set<InitiativeState>([
    'planned',
    'in_progress',
    'awaiting_approval',
    'blocked',
    'on_hold',
    'completed_verified',
]);

const CONTENT = new Set<ContentState>(['draft', 'review', 'approved', 'published']);

function text(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function day(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const iso = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function priority(value: unknown): InitiativePriority {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (number === 1 || number === 2 || number === 3 || number === 4) return number;
    throw new Error('Unexpected initiative row.');
}

function mapItem(row: Record<string, unknown>): InitiativeItem {
    const id = text(row.id);
    const title = text(row.title);
    const contentState = text(row.content_state);
    if (!id || !title || !contentState || !CONTENT.has(contentState as ContentState)) {
        throw new Error('Unexpected initiative row.');
    }
    const position = typeof row.position === 'number' ? row.position : Number(row.position);
    return {
        id,
        title,
        contentState: contentState as ContentState,
        draftUrl: safeHttpUrl(text(row.draft_url)),
        liveUrl: safeHttpUrl(text(row.live_url)),
        publishedOn: day(row.published_on),
        position: Number.isFinite(position) ? position : 0,
    };
}

function mapInitiative(row: Record<string, unknown>, items: InitiativeItem[]): CampaignInitiative {
    const id = text(row.id);
    const organizationId = text(row.organization_id);
    const clientId = text(row.client_id);
    const title = text(row.title);
    const state = text(row.state);
    if (!id || !organizationId || !clientId || !title || !state || !STATES.has(state as InitiativeState)) {
        throw new Error('Unexpected initiative row.');
    }
    const story = readInitiativeStory(row);
    return {
        id,
        organizationId,
        clientId,
        title,
        purpose: text(row.purpose),
        ownerName: text(row.owner_name),
        phase: story.phase,
        category: story.category,
        targetMonth: story.targetMonth,
        priority: priority(row.priority),
        state: state as InitiativeState,
        startsOn: day(row.starts_on),
        endsOn: day(row.ends_on),
        pageUrl: safeHttpUrl(text(row.page_url)),
        successMetricLabel: text(row.success_metric_label),
        evidenceUrl: safeHttpUrl(text(row.evidence_url)),
        verifiedOn: day(row.verified_on),
        items: items.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title)),
    };
}

function rows(data: unknown): Record<string, unknown>[] {
    if (!Array.isArray(data)) return [];
    return data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
}

export async function listCampaignInitiatives(clientId: string): Promise<InitiativeRead> {
    const supabase = createClient();
    if (!supabase || !clientId) return { initiatives: [], unavailable: true };
    try {
        const [initiativeResult, itemResult] = await Promise.all([
            supabase.from('campaign_initiatives').select('*').eq('client_id', clientId),
            supabase.from('campaign_initiative_items').select('*').eq('client_id', clientId),
        ]);
        if (initiativeResult.error || itemResult.error) {
            console.error('[campaign-initiatives] list', initiativeResult.error ?? itemResult.error);
            return { initiatives: [], unavailable: true };
        }
        const itemsByParent = new Map<string, InitiativeItem[]>();
        for (const row of rows(itemResult.data)) {
            const item = mapItem(row);
            const parentId = text(row.initiative_id);
            if (!parentId) continue;
            const list = itemsByParent.get(parentId) ?? [];
            list.push(item);
            itemsByParent.set(parentId, list);
        }
        const initiatives = rows(initiativeResult.data).map(row => mapInitiative(row, itemsByParent.get(text(row.id) ?? '') ?? []));
        return { initiatives, unavailable: false };
    } catch (error) {
        console.error('[campaign-initiatives] list', error);
        return { initiatives: [], unavailable: true };
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
        console.error('[campaign-initiatives] client', error);
        return initiativeWriteScope({ client: null });
    }
    const record = data as { id?: unknown; organization_id?: unknown } | null;
    const client = record && typeof record.id === 'string' && typeof record.organization_id === 'string'
        && record.id === clientId
        ? { id: record.id, organizationId: record.organization_id }
        : null;
    return initiativeWriteScope({ client, assertedOrganizationId });
}

async function writeItems(
    supabase: NonNullable<ReturnType<typeof createClient>>,
    scope: { organizationId: string; clientId: string },
    initiativeId: string,
    write: InitiativeWrite,
) {
    const existing = await supabase
        .from('campaign_initiative_items')
        .select('id')
        .eq('initiative_id', initiativeId)
        .eq('client_id', scope.clientId);
    if (existing.error) throw new Error('Could not save this initiative.');
    const keep = new Set(write.items.flatMap(item => item.id ? [item.id] : []));
    const remove = rows(existing.data)
        .map(row => text(row.id))
        .filter((id): id is string => Boolean(id && !keep.has(id)));
    if (remove.length > 0) {
        const deleted = await supabase
            .from('campaign_initiative_items')
            .delete()
            .in('id', remove)
            .eq('client_id', scope.clientId);
        if (deleted.error) throw new Error('Could not save this initiative.');
    }
    for (const item of write.items) {
        const row = initiativeItemRow(scope, initiativeId, item);
        if (item.id) {
            const updated = await supabase
                .from('campaign_initiative_items')
                .update(row)
                .eq('id', item.id)
                .eq('initiative_id', initiativeId)
                .eq('client_id', scope.clientId);
            if (updated.error) throw new Error('Could not save this initiative.');
        } else {
            const inserted = await supabase.from('campaign_initiative_items').insert(row);
            if (inserted.error) throw new Error('Could not save this initiative.');
        }
    }
}

export async function saveCampaignInitiative(input: {
    clientId: string;
    assertedOrganizationId?: string | null;
    initiativeId?: string | null;
    draft: InitiativeDraft;
}): Promise<{ id: string }> {
    const normalized = normalizeInitiativeDraft(input.draft);
    if (!normalized.ok) throw new Error(normalized.error);
    const supabase = createClient();
    if (!supabase) throw new Error('Sign in to save an initiative.');
    const scope = await resolveScope(supabase, input.clientId, input.assertedOrganizationId);
    if (!scope.ok) throw new Error(scope.error);
    const row = initiativeRow(scope, normalized.value);
    const initiativeId = input.initiativeId?.trim() || null;
    let id = initiativeId;
    if (id) {
        const updated = await supabase
            .from('campaign_initiatives')
            .update(row)
            .eq('id', id)
            .eq('client_id', scope.clientId)
            .select('id')
            .maybeSingle();
        if (updated.error) {
            console.error('[campaign-initiatives] update', updated.error);
            throw new Error('Could not save this initiative.');
        }
        const saved = updated.data as { id?: unknown } | null;
        if (!saved || saved.id !== id) throw new Error('This initiative is not on this client.');
    } else {
        const inserted = await supabase
            .from('campaign_initiatives')
            .insert(row)
            .select('id')
            .single();
        if (inserted.error) {
            console.error('[campaign-initiatives] insert', inserted.error);
            throw new Error('Could not save this initiative.');
        }
        const saved = inserted.data as { id?: unknown } | null;
        if (!saved || typeof saved.id !== 'string') throw new Error('Could not save this initiative.');
        id = saved.id;
    }
    try {
        await writeItems(supabase, scope, id, normalized.value);
    } catch (error) {
        console.error('[campaign-initiatives] items', error);
        if (error instanceof Error && error.message === 'Could not save this initiative.') throw error;
        throw new Error('Could not save this initiative.');
    }
    return { id };
}

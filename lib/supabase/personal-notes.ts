import { createClient } from './client';
import { PersonalNote } from '../types';

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToNote(row: any): PersonalNote {
    return {
        id: row.id,
        organizationId: row.organization_id,
        userId: row.user_id,
        title: row.title ?? '',
        contentHtml: row.content_html ?? '',
        taskId: row.task_id ?? undefined,
        archivedAt: row.archived_at ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listPersonalNotes(params: {
    organizationId: string;
    userId: string;
    archived?: boolean;
}): Promise<PersonalNote[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        let query = supabase
            .from('personal_notes')
            .select('*')
            .eq('organization_id', params.organizationId)
            .eq('user_id', params.userId)
            .order('updated_at', { ascending: false });
        query = params.archived
            ? query.not('archived_at', 'is', null)
            : query.is('archived_at', null);
        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []).map(rowToNote);
    } catch (err) {
        console.error('[personal-notes] list error:', err);
        return [];
    }
}

export async function createPersonalNote(params: {
    organizationId: string;
    userId: string;
    title?: string;
}): Promise<PersonalNote | null> {
    const supabase = createClient();
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('personal_notes')
            .insert([{
                organization_id: params.organizationId,
                user_id: params.userId,
                title: params.title ?? '',
            }])
            .select('*')
            .single();
        if (error) throw error;
        return rowToNote(data);
    } catch (err) {
        console.error('[personal-notes] create error:', err);
        return null;
    }
}

export async function updatePersonalNote(
    id: string,
    patch: {
        title?: string;
        contentHtml?: string;
        taskId?: string | null;
        archivedAt?: string | null;
    },
): Promise<PersonalNote | null> {
    const supabase = createClient();
    if (!supabase) return null;
    try {
        const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (patch.title !== undefined) row.title = patch.title;
        if (patch.contentHtml !== undefined) row.content_html = patch.contentHtml;
        if (patch.taskId !== undefined) row.task_id = patch.taskId;
        if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt;
        const { data, error } = await supabase
            .from('personal_notes')
            .update(row)
            .eq('id', id)
            .select('*')
            .single();
        if (error) throw error;
        return rowToNote(data);
    } catch (err) {
        console.error('[personal-notes] update error:', err);
        return null;
    }
}

export async function deletePersonalNote(id: string): Promise<boolean> {
    const supabase = createClient();
    if (!supabase) return false;
    try {
        const { error } = await supabase.from('personal_notes').delete().eq('id', id);
        if (error) throw error;
        return true;
    } catch (err) {
        console.error('[personal-notes] delete error:', err);
        return false;
    }
}

import { createClient } from './client';
import { ClientNote } from '../types';

function rowToClientNote(row: any): ClientNote {
    return {
        id: row.id,
        organizationId: row.organization_id,
        clientId: row.client_id,
        content: row.content,
        authorName: row.author_name || 'Team',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export async function getClientNotes(clientId: string): Promise<ClientNote[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('client_notes')
            .select('*')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(rowToClientNote);
    } catch (err) {
        console.error('Error fetching client notes:', err);
        return [];
    }
}

export async function createClientNote(note: {
    organizationId: string;
    clientId: string;
    content: string;
    authorName: string;
}): Promise<{ success: boolean; data?: ClientNote; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { data, error } = await supabase
            .from('client_notes')
            .insert([{
                organization_id: note.organizationId,
                client_id: note.clientId,
                content: note.content,
                author_name: note.authorName,
            }])
            .select()
            .single();
        if (error) throw error;
        return { success: true, data: rowToClientNote(data) };
    } catch (err: any) {
        console.error('Error creating client note:', err);
        return { success: false, error: err.message };
    }
}

export async function updateClientNote(
    id: string,
    content: string,
): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { error } = await supabase
            .from('client_notes')
            .update({ content, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

export async function deleteClientNote(id: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { error } = await supabase.from('client_notes').delete().eq('id', id);
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

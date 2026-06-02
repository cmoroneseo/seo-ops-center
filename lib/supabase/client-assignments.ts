import { createBrowserClient } from '@supabase/ssr';
import { ClientAssignment } from '@/lib/types';

function getClient() {
    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
}

function rowToAssignment(row: any): ClientAssignment {
    return {
        id: row.id,
        organizationId: row.organization_id,
        clientId: row.client_id,
        assignedTo: row.assigned_to,
        assignedBy: row.assigned_by,
        assignedAt: row.assigned_at,
        unassignedAt: row.unassigned_at ?? undefined,
        notes: row.notes ?? undefined,
    };
}

/** All assignment history for a client, newest first */
export async function getClientAssignments(clientId: string): Promise<ClientAssignment[]> {
    const supabase = getClient();
    const { data, error } = await supabase
        .from('client_assignments')
        .select('*')
        .eq('client_id', clientId)
        .order('assigned_at', { ascending: false });

    if (error) {
        console.error('getClientAssignments error:', error);
        return [];
    }
    return (data ?? []).map(rowToAssignment);
}

/** Reassign a client: closes current active assignment + opens new one */
export async function reassignClient({
    clientId,
    organizationId,
    newAssigneeName,
    assignedByName,
    notes,
}: {
    clientId: string;
    organizationId: string;
    newAssigneeName: string;
    assignedByName: string;
    notes?: string;
}): Promise<{ error: string | null }> {
    const supabase = getClient();
    const now = new Date().toISOString();

    // Close any currently active assignment
    const { error: closeError } = await supabase
        .from('client_assignments')
        .update({ unassigned_at: now })
        .eq('client_id', clientId)
        .is('unassigned_at', null);

    if (closeError) {
        console.error('reassignClient close error:', closeError);
        return { error: closeError.message };
    }

    // Open new assignment
    const { error: insertError } = await supabase
        .from('client_assignments')
        .insert({
            client_id: clientId,
            organization_id: organizationId,
            assigned_to: newAssigneeName,
            assigned_by: assignedByName,
            assigned_at: now,
            notes: notes || null,
        });

    if (insertError) {
        console.error('reassignClient insert error:', insertError);
        return { error: insertError.message };
    }

    // Update account_manager on clients table
    const { error: updateError } = await supabase
        .from('clients')
        .update({ account_manager: newAssigneeName })
        .eq('id', clientId);

    if (updateError) {
        console.error('reassignClient update clients error:', updateError);
        return { error: updateError.message };
    }

    return { error: null };
}

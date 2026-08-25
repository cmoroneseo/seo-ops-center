import { createAdminClient } from '@/lib/supabase/admin';
import type {
    ImportedEntryInput,
    TimesheetImportStore,
} from './timesheet-webhook-route';

/**
 * Supabase-backed persistence for inbound Basecamp timesheet entries.
 *
 * Runs with the service role because `time_logs` provenance columns are
 * trigger-protected against browser writes (migrations 032 and 038). Every
 * value written here came from an authenticated Basecamp read, never a payload.
 */

/**
 * Deduplication is done by explicit read-then-write rather than an upsert:
 * the invariant index on `basecamp_entry_id` is partial, and PostgREST cannot
 * express `on conflict (col) where col is not null`. The index still backstops
 * a race — a losing insert raises 23505 and is retried as an update.
 */
async function writeImportedEntry(input: ImportedEntryInput): Promise<'created' | 'updated'> {
    const admin = createAdminClient();
    const entryId = Number(input.basecampEntryId);

    const row = {
        organization_id: input.organizationId,
        client_id: input.clientId,
        task_id: input.taskId,
        user_id: input.userId,
        date: input.date,
        hours: input.hours,
        description: input.description,
        status: 'logged',
        source: 'basecamp',
        import_status: input.importStatus,
        basecamp_entry_id: entryId,
        basecamp_project_id: Number(input.basecampProjectId),
        basecamp_recording_id: Number(input.basecampRecordingId),
        basecamp_synced_at: input.importedAt,
        basecamp_sync_error: null,
        imported_at: input.importedAt,
        provider_updated_at: input.providerUpdatedAt || null,
        // A previously voided entry that reappears at the provider is live again.
        voided_at: null,
    };

    const existing = await admin
        .from('time_logs')
        .select('id')
        .eq('basecamp_entry_id', entryId)
        .maybeSingle();
    if (existing.error) throw existing.error;

    if (existing.data) {
        const { error } = await admin
            .from('time_logs')
            .update(row)
            .eq('id', existing.data.id);
        if (error) throw error;
        return 'updated';
    }

    const { error } = await admin.from('time_logs').insert(row);
    if (!error) return 'created';
    if (error.code !== '23505') throw error;

    // Lost the race against a concurrent delivery — reconcile onto that row.
    const { error: updateError } = await admin
        .from('time_logs')
        .update(row)
        .eq('basecamp_entry_id', entryId);
    if (updateError) throw updateError;
    return 'updated';
}

export function createTimesheetImportStore(): TimesheetImportStore {
    return {
        async findClientForProject(projectId) {
            const { data, error } = await createAdminClient()
                .from('clients')
                .select('id, organization_id, custom_fields')
                .eq('custom_fields->>basecamp_project_id', projectId);
            if (error) throw error;

            const match = (data ?? []).find(client => {
                const fields = (client.custom_fields as Record<string, unknown>) ?? {};
                return Boolean(fields.basecamp_sync_enabled && fields.basecamp_timesheet_enabled);
            });
            return match
                ? { organizationId: match.organization_id, clientId: match.id }
                : null;
        },

        async findMemberForPerson(organizationId, personId) {
            const { data, error } = await createAdminClient()
                .from('organization_members')
                .select('user_id')
                .eq('organization_id', organizationId)
                .eq('basecamp_person_id', personId)
                .maybeSingle();
            if (error) throw error;
            return data?.user_id ? { userId: data.user_id } : null;
        },

        async findTaskForTodo(organizationId, todoId) {
            const { data, error } = await createAdminClient()
                .from('tasks')
                .select('id, client_id')
                .eq('organization_id', organizationId)
                .eq('basecamp_todo_id', todoId)
                .maybeSingle();
            if (error) throw error;
            return data ? { taskId: data.id, clientId: data.client_id ?? null } : null;
        },

        upsertImportedEntry: writeImportedEntry,

        async voidImportedEntry(entryId, at) {
            const { data, error } = await createAdminClient()
                .from('time_logs')
                .update({ import_status: 'voided', voided_at: at })
                .eq('basecamp_entry_id', Number(entryId))
                .is('voided_at', null)
                .select('id');
            if (error) throw error;
            return (data?.length ?? 0) > 0 ? 'voided' : 'absent';
        },
    };
}

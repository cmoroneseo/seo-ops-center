import { createAdminClient } from '@/lib/supabase/admin';
import { mergeImportedEntry } from './timesheet-import-merge';
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
function incomingEntryId(input: ImportedEntryInput): number | null {
    if (!input.basecampEntryId) return null;
    const parsed = Number(input.basecampEntryId);
    return Number.isFinite(parsed) ? parsed : null;
}

async function writeImportedEntry(input: ImportedEntryInput): Promise<'created' | 'updated'> {
    const admin = createAdminClient();
    const entryId = incomingEntryId(input);

    // Entry id first; fall back to the CSV fingerprint so a webhook adopts the
    // row a backfill already created instead of inserting beside it.
    let existing = entryId === null
        ? { data: null, error: null }
        : await admin
            .from('time_logs')
            .select('id, source, import_status, client_id, task_id, user_id, activity_key, import_fingerprint')
            .eq('basecamp_entry_id', entryId)
            .maybeSingle();
    if (existing.error) throw existing.error;

    if (!existing.data && input.importFingerprint) {
        existing = await admin
            .from('time_logs')
            .select('id, source, import_status, client_id, task_id, user_id, activity_key, import_fingerprint')
            .eq('import_fingerprint', input.importFingerprint)
            .maybeSingle();
        if (existing.error) throw existing.error;
    }

    // An import may add attribution, never remove it — see mergeImportedEntry.
    const row = mergeImportedEntry(
        existing.data
            ? {
                source: existing.data.source ?? 'seo_pm',
                importStatus: existing.data.import_status ?? 'mapped',
                clientId: existing.data.client_id ?? null,
                taskId: existing.data.task_id ?? null,
                userId: existing.data.user_id ?? null,
                activityKey: existing.data.activity_key ?? null,
                importFingerprint: existing.data.import_fingerprint ?? null,
            }
            : null,
        input,
    );

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
    const recovery = admin.from('time_logs').update(row);
    const { error: updateError } = entryId !== null
        ? await recovery.eq('basecamp_entry_id', entryId)
        : await recovery.eq('import_fingerprint', input.importFingerprint ?? '');
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

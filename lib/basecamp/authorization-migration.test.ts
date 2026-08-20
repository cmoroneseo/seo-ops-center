import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../../migrations/031_protect_basecamp_authorization_state.sql', import.meta.url);
const correctionMigrationUrl = new URL('../../migrations/032_close_identity_and_provider_provenance.sql', import.meta.url);
const schemaUrl = new URL('../../schema.sql', import.meta.url);

test('migration protects every browser-writable Basecamp authorization field without rewriting data', async () => {
    const sql = await readFile(migrationUrl, 'utf8');

    for (const invariant of [
        'protect_organization_internal_status',
        'NEW.is_internal IS DISTINCT FROM OLD.is_internal',
        'protect_client_basecamp_fields',
        "entry.key LIKE 'basecamp\\_%' ESCAPE '\\'",
        'protect_task_basecamp_linkage',
        'NEW.basecamp_todo_id IS DISTINCT FROM OLD.basecamp_todo_id',
        'NEW.basecamp_project_id IS DISTINCT FROM OLD.basecamp_project_id',
        'protect_time_log_basecamp_entry',
        'NEW.basecamp_entry_id IS DISTINCT FROM OLD.basecamp_entry_id',
        "auth.role() = 'service_role'",
        'SET search_path = pg_catalog, public',
    ]) {
        assert.match(sql, new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }

    assert.doesNotMatch(sql, /^\s*(update|delete from|truncate)\s/mgi);
});

test('schema snapshot mirrors the authorization triggers', async () => {
    const schema = await readFile(schemaUrl, 'utf8');
    for (const trigger of [
        'protect_organization_internal_status',
        'protect_client_basecamp_fields',
        'protect_task_basecamp_linkage',
        'protect_time_log_basecamp_tuple',
    ]) {
        assert.match(schema, new RegExp(`create trigger ${trigger}`, 'i'));
    }
});

test('additive correction migration closes membership, invite, OAuth, and timesheet trust gaps', async () => {
    const sql = await readFile(correctionMigrationUrl, 'utf8');
    for (const invariant of [
        'DROP POLICY IF EXISTS "Authenticated users can join organizations during setup"',
        'public.bootstrap_organization_owner',
        "organization.created_by IS DISTINCT FROM auth.uid()",
        "'owner'",
        'public.organization_invites',
        'public.consume_organization_invite',
        'public.basecamp_oauth_states',
        'basecamp_recording_id',
        'protect_time_log_basecamp_tuple',
        'jsonb_typeof',
        'DROP FUNCTION IF EXISTS public.protect_time_log_basecamp_entry()',
    ]) {
        assert.match(sql, new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
    assert.doesNotMatch(sql, /UPDATE\s+public\.time_logs\s+SET/i);
    assert.doesNotMatch(sql, /UPDATE\s+public\.clients\s+SET/i);
});

test('schema snapshot mirrors correction tables, RPC, and protected recording tuple', async () => {
    const schema = await readFile(schemaUrl, 'utf8');
    for (const invariant of [
        'create table public.organization_invites',
        'create table public.basecamp_oauth_states',
        'create or replace function public.bootstrap_organization_owner',
        'basecamp_recording_id bigint',
        'create trigger protect_time_log_basecamp_tuple',
    ]) {
        assert.match(schema, new RegExp(invariant, 'i'));
    }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../../migrations/031_protect_basecamp_authorization_state.sql', import.meta.url);
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
        'protect_time_log_basecamp_entry',
    ]) {
        assert.match(schema, new RegExp(`create trigger ${trigger}`, 'i'));
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migrationUrl = new URL('../../migrations/038_timesheet_ledger.sql', import.meta.url);
const schemaUrl = new URL('../../schema.sql', import.meta.url);

function sources() {
    assert.ok(existsSync(migrationUrl), 'missing timesheet ledger migration 038');
    return {
        migration: readFileSync(migrationUrl, 'utf8'),
        schema: readFileSync(schemaUrl, 'utf8'),
    };
}

test('migration 038 is additive only', () => {
    const { migration } = sources();
    assert.doesNotMatch(migration, /drop table|drop column|truncate|delete from/i);
});

test('time_logs gains ledger source and import provenance', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(sql, /source text not null default 'seo_pm'/i);
        assert.match(sql, /source in \('seo_pm', 'basecamp'\)/i);
        assert.match(sql, /import_status text not null default 'mapped'/i);
        assert.match(sql, /import_status in \('mapped', 'needs_review', 'voided'\)/i);
        assert.match(sql, /imported_at timestamp with time zone/i);
        assert.match(sql, /provider_updated_at timestamp with time zone/i);
        assert.match(sql, /voided_at timestamp with time zone/i);
    }
});

test('basecamp_entry_id has a partial unique deduplication index', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(
            sql,
            /create unique index if not exists time_logs_basecamp_entry_unique\s+on public\.time_logs \(basecamp_entry_id\)\s+where basecamp_entry_id is not null/i,
        );
    }
});

test('import provenance columns are service-role only', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(sql, /function public\.protect_time_log_import_provenance\(\)/i);
        assert.match(sql, /security definer/i);
        assert.match(sql, /auth\.role\(\) = 'service_role'/i);
        assert.match(sql, /time log import provenance is server-controlled/i);
        assert.match(sql, /errcode = '42501'/i);
        assert.match(
            sql,
            /trigger protect_time_log_import_provenance\s+before insert or update of source, import_status, imported_at, provider_updated_at, voided_at/i,
        );
    }
});

test('approval tables exist with immutable snapshot columns', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(sql, /create table if not exists public\.timesheet_client_approvals/i);
        assert.match(sql, /month text not null/i);
        assert.match(sql, /status text not null default 'approved' check \(status in \('approved', 'reopened'\)\)/i);
        assert.match(sql, /budget_minutes integer not null default 0/i);
        assert.match(sql, /eligible_minutes integer not null default 0/i);
        assert.match(sql, /non_budget_minutes integer not null default 0/i);
        assert.match(sql, /snapshot jsonb not null default '\{\}'::jsonb/i);
        assert.match(sql, /create table if not exists public\.timesheet_approval_entries/i);
        assert.match(sql, /unique \(approval_id, time_log_id\)/i);
    }
});

test('only one active approval can exist per client month', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(
            sql,
            /create unique index if not exists timesheet_client_approvals_active_unique\s+on public\.timesheet_client_approvals \(client_id, month\)\s+where status = 'approved'/i,
        );
    }
});

test('approval tables are RLS scoped and not browser-writable', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(sql, /alter table public\.timesheet_client_approvals\s+enable row level security/i);
        assert.match(sql, /alter table public\.timesheet_approval_entries\s+enable row level security/i);
        assert.match(sql, /organization_id in \(select get_user_org_ids\(\)\)/i);
        // writes are service-role only
        assert.match(
            sql,
            /grant select, insert, update, delete on table public\.timesheet_client_approvals\s+to service_role/i,
        );
        assert.match(
            sql,
            /grant select, insert, update, delete on table public\.timesheet_approval_entries\s+to service_role/i,
        );
    }
});

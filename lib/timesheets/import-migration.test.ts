import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migrationUrl = new URL('../../migrations/040_timesheet_import_review.sql', import.meta.url);
const schemaUrl = new URL('../../schema.sql', import.meta.url);

function sources() {
    assert.ok(existsSync(migrationUrl), 'missing migration 040');
    return {
        migration: readFileSync(migrationUrl, 'utf8'),
        schema: readFileSync(schemaUrl, 'utf8'),
    };
}

test('migration 040 is additive only', () => {
    const { migration } = sources();
    assert.doesNotMatch(migration, /drop table|drop column|truncate|delete from/i);
});

test('import_status gains the review states and drops needs_review', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(
            sql,
            /import_status in \('needs_context', 'pending_review', 'mapped', 'voided'\)/i,
        );
    }
    // Existing rows must be migrated, not stranded on a now-invalid value.
    assert.match(migration, /update public\.time_logs\s+set import_status = 'needs_context'\s+where import_status = 'needs_review'/i);
});

test('time_logs gains activity, fingerprint, and review columns', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(sql, /activity_key text/i);
        assert.match(sql, /import_fingerprint text/i);
        assert.match(sql, /submitted_at timestamp with time zone/i);
        assert.match(sql, /submitted_by uuid/i);
        assert.match(sql, /reviewed_at timestamp with time zone/i);
        assert.match(sql, /reviewed_by uuid/i);
        assert.match(sql, /review_note text/i);
    }
});

test('import_fingerprint has a partial unique index', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(
            sql,
            /create unique index if not exists time_logs_import_fingerprint_unique\s+on public\.time_logs \(import_fingerprint\)\s+where import_fingerprint is not null/i,
        );
    }
});

test('the provenance trigger covers the new provider columns', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(
            sql,
            /before insert or update of source, import_status, imported_at, provider_updated_at, voided_at, import_fingerprint/i,
        );
    }
});

test('basecamp_project_roles exists, is RLS scoped, and constrains role', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(sql, /create table if not exists public\.basecamp_project_roles/i);
        assert.match(sql, /role text not null check \(role in \('client', 'internal', 'ignored'\)\)/i);
        assert.match(sql, /basecamp_project_name text/i);
        assert.match(sql, /alter table public\.basecamp_project_roles\s+enable row level security/i);
        assert.match(
            sql,
            /create unique index if not exists basecamp_project_roles_unique\s+on public\.basecamp_project_roles \(organization_id, basecamp_project_id\)/i,
        );
    }
});

test('a client role must name a client', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(sql, /check \(role <> 'client' or client_id is not null\)/i);
    }
});

test('timesheet_import_runs records each backfill', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(sql, /create table if not exists public\.timesheet_import_runs/i);
        assert.match(sql, /source text not null check \(source in \('csv', 'upload', 'webhook'\)\)/i);
        assert.match(sql, /scanned integer not null default 0/i);
        assert.match(sql, /imported integer not null default 0/i);
        assert.match(sql, /skipped integer not null default 0/i);
    }
});

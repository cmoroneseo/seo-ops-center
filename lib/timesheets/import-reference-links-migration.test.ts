import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migrationUrl = new URL(
    '../../migrations/043_timesheet_reference_links.sql',
    import.meta.url,
);
const appliedRpcUrls = [
    new URL('../../migrations/041_atomic_timesheet_import_transitions.sql', import.meta.url),
    new URL('../../migrations/042_timesheet_entry_activities.sql', import.meta.url),
];
const schemaUrl = new URL('../../schema.sql', import.meta.url);

function sources() {
    assert.ok(existsSync(migrationUrl), 'missing migration 043');
    return {
        migration: readFileSync(migrationUrl, 'utf8'),
        schema: readFileSync(schemaUrl, 'utf8'),
    };
}

test('migration 043 is additive only', () => {
    const { migration } = sources();
    assert.doesNotMatch(migration, /drop table|drop column|truncate|delete from/i);
});

test('time_logs gains a non-null reference_links array defaulting to empty', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(
            sql,
            /add column if not exists reference_links jsonb not null default '\[\]'::jsonb/i,
        );
    }
});

test('a CHECK constraint keeps the column a JSON array', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(sql, /add constraint time_logs_reference_links_is_array/i);
        assert.match(sql, /check \(jsonb_typeof\(reference_links\) = 'array'\)/i);
        // The constraint must land after the column exists.
        assert.ok(
            sql.search(/add constraint time_logs_reference_links_is_array/i)
                > sql.search(/add column if not exists reference_links/i),
            'the constraint must be added AFTER reference_links exists',
        );
    }
});

test('migrations 041 and 042 are superseded, never edited in place', () => {
    const { migration } = sources();
    for (const url of appliedRpcUrls) {
        const applied = readFileSync(url, 'utf8');
        assert.doesNotMatch(
            applied,
            /reference_links/,
            `${url.pathname} is applied to production and must not mention reference_links`,
        );
    }

    // 043 carries the replacement definition instead.
    assert.match(
        migration,
        /create or replace function public\.apply_timesheet_import_transition/i,
    );
});

test('the superseding RPC whitelists and applies reference_links', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(sql, /'activity_keys',\s*\n\s*'reference_links',\s*\n\s*'description',/);
        assert.match(
            sql,
            /set activity_keys = case[\s\S]*?reference_links = case\s+when p_updates \? 'reference_links' then p_updates -> 'reference_links'\s+else target\.reference_links/i,
        );
    }
});

test('the RPC rejects anything that is not a list of {label, url} objects', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(sql, /jsonb_typeof\(p_updates -> 'reference_links'\) <> 'array'/i);
        assert.match(sql, /jsonb_typeof\(link\.value\) <> 'object'/i);
        assert.match(sql, /jsonb_typeof\(link\.value -> 'label'\) is distinct from 'string'/i);
        assert.match(sql, /jsonb_typeof\(link\.value -> 'url'\) is distinct from 'string'/i);
        assert.match(sql, /invalid timesheet import transition reference links/);
    }
});

test('the superseding RPC keeps every earlier guard', () => {
    const { migration } = sources();
    // Tenant scope, duplicate-id rejection, expected-status lock, the
    // internal-project forcing, and the multi-activity handling all carry over.
    assert.match(migration, /security invoker/i);
    assert.match(migration, /set search_path = ''/i);
    assert.match(migration, /cardinality\(p_ids\) <> \(/i);
    assert.match(migration, /for update\s+\) as locked_targets/i);
    assert.match(migration, /timesheet_import_transition_conflict/);
    assert.match(migration, /basecamp_project_roles\.role = 'internal'/);
    assert.match(migration, /jsonb_typeof\(p_updates -> 'activity_keys'\) <> 'array'/i);
    assert.match(migration, /array_position\(v_activity_keys, null\) is not null/i);
    assert.match(
        migration,
        /revoke execute on function public\.apply_timesheet_import_transition/i,
    );
    assert.match(
        migration,
        /grant execute on function public\.apply_timesheet_import_transition\(uuid, uuid\[\], uuid, text, jsonb\)\s+to service_role/i,
    );
});

test('the write still happens in one UPDATE, after the lock', () => {
    const { migration } = sources();
    assert.ok(
        migration.search(/for update\s+\) as locked_targets/i)
            < migration.search(/update public\.time_logs as target/i),
        'targets must be locked before the write',
    );
    assert.equal(
        migration.match(/update public\.time_logs as target/gi)?.length,
        1,
        'reference_links must ride the existing single UPDATE, not a second one',
    );
});

test('schema.sql mirrors migration 043 verbatim', () => {
    const { migration, schema } = sources();
    assert.ok(
        schema.includes(migration.trim()),
        'schema.sql must contain migration 043 verbatim',
    );
});

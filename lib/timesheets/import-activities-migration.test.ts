import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migrationUrl = new URL(
    '../../migrations/042_timesheet_entry_activities.sql',
    import.meta.url,
);
const appliedRpcUrl = new URL(
    '../../migrations/041_atomic_timesheet_import_transitions.sql',
    import.meta.url,
);
const schemaUrl = new URL('../../schema.sql', import.meta.url);

function sources() {
    assert.ok(existsSync(migrationUrl), 'missing migration 042');
    return {
        migration: readFileSync(migrationUrl, 'utf8'),
        schema: readFileSync(schemaUrl, 'utf8'),
    };
}

test('migration 042 is additive only', () => {
    const { migration } = sources();
    assert.doesNotMatch(migration, /drop table|drop column|truncate|delete from/i);
    // activity_key stays where it is; code simply stops reading and writing it.
    assert.doesNotMatch(migration, /drop .*activity_key/i);
});

test('time_logs gains a non-null activity_keys array defaulting to empty', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(
            sql,
            /add column if not exists activity_keys text\[\] not null default '\{\}'/i,
        );
    }
});

test('the single activity_key is backfilled into the array', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        const backfill = /update public\.time_logs\s+set activity_keys = array\[activity_key\]\s+where activity_key is not null/i;
        assert.match(sql, backfill);
        // The column must exist before anything writes to it.
        assert.ok(
            sql.search(backfill) > sql.search(/add column if not exists activity_keys/i),
            'the backfill must run AFTER activity_keys is added',
        );
    }
});

test('migration 041 is superseded, never edited in place', () => {
    const { migration } = sources();
    const applied = readFileSync(appliedRpcUrl, 'utf8');

    // 041 is already applied to production. It must still read exactly as it
    // did, whitelisting the single activity_key.
    assert.match(applied, /'activity_key',/);
    assert.doesNotMatch(applied, /activity_keys/);

    // 042 carries the replacement definition instead.
    assert.match(
        migration,
        /create or replace function public\.apply_timesheet_import_transition/i,
    );
});

test('the superseding RPC whitelists and applies activity_keys', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(sql, /'activity_keys',\s*\n\s*'description',/);
        assert.match(
            sql,
            /set activity_keys = case\s+when p_updates \? 'activity_keys' then v_activity_keys\s+else target\.activity_keys/i,
        );
        // A patch must supply a real array, and never a null element.
        assert.match(sql, /jsonb_typeof\(p_updates -> 'activity_keys'\) <> 'array'/i);
        assert.match(sql, /array_position\(v_activity_keys, null\) is not null/i);
    }
});

test('the superseding RPC keeps every migration 041 guard', () => {
    const { migration } = sources();
    // Tenant scope, duplicate-id rejection, expected-status lock, and the
    // internal-project forcing all carry over unchanged.
    assert.match(migration, /security invoker/i);
    assert.match(migration, /set search_path = ''/i);
    assert.match(migration, /cardinality\(p_ids\) <> \(/i);
    assert.match(migration, /for update\s+\) as locked_targets/i);
    assert.match(migration, /timesheet_import_transition_conflict/);
    assert.match(migration, /basecamp_project_roles\.role = 'internal'/);
    assert.match(
        migration,
        /revoke execute on function public\.apply_timesheet_import_transition/i,
    );
    assert.match(migration, /grant execute on function public\.apply_timesheet_import_transition\(uuid, uuid\[\], uuid, text, jsonb\)\s+to service_role/i);
});

test('schema.sql mirrors migration 042 verbatim', () => {
    const { migration, schema } = sources();
    assert.ok(
        schema.includes(migration.trim()),
        'schema.sql must contain migration 042 verbatim',
    );
});

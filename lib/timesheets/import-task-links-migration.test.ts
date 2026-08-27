import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migrationUrl = new URL(
    '../../migrations/044_timesheet_task_links.sql',
    import.meta.url,
);
const appliedRpcUrls = [
    new URL('../../migrations/041_atomic_timesheet_import_transitions.sql', import.meta.url),
    new URL('../../migrations/042_timesheet_entry_activities.sql', import.meta.url),
    new URL('../../migrations/043_timesheet_reference_links.sql', import.meta.url),
];
const schemaUrl = new URL('../../schema.sql', import.meta.url);

function sources() {
    assert.ok(existsSync(migrationUrl), 'missing migration 044');
    return {
        migration: readFileSync(migrationUrl, 'utf8'),
        schema: readFileSync(schemaUrl, 'utf8'),
    };
}

/** The RPC definition only, so 043's copy in schema.sql never answers for 044. */
function rpcBody(sql: string): string {
    const start = sql.indexOf(
        'create or replace function public.apply_timesheet_import_transition',
    );
    assert.ok(start >= 0, 'no RPC definition found');
    return sql.slice(start);
}

test('migration 044 is additive only', () => {
    const { migration } = sources();
    assert.doesNotMatch(migration, /drop table|drop column|truncate|delete from/i);
    // task_id has existed on time_logs since 001; 044 only teaches the RPC to
    // write it, and must not try to re-add or re-type the column.
    assert.doesNotMatch(migration, /alter table public\.time_logs/i);
});

test('migrations 041 through 043 are superseded, never edited in place', () => {
    const { migration } = sources();
    for (const url of appliedRpcUrls) {
        assert.doesNotMatch(
            readFileSync(url, 'utf8'),
            /task_id/,
            `${url.pathname} is applied to production and must not mention task_id`,
        );
    }

    assert.match(
        migration,
        /create or replace function public\.apply_timesheet_import_transition/i,
    );
});

test('the superseding RPC whitelists task_id as a patch key', () => {
    const { migration } = sources();
    assert.match(
        rpcBody(migration),
        /'reference_links',\s*\n\s*'task_id',\s*\n\s*'description',/,
    );
});

test('a linked task must exist inside the patching organization', () => {
    const { migration } = sources();
    const body = rpcBody(migration);
    assert.match(body, /v_task_id := \(p_updates ->> 'task_id'\)::uuid;/);
    assert.match(body, /invalid timesheet import transition task/);
    assert.match(
        body,
        /from public\.tasks\s+where tasks\.id = v_task_id\s+and tasks\.organization_id = p_organization_id\s+for key share;/i,
    );
});

test('a linked task must belong to the same client as every patched row', () => {
    const { migration } = sources();
    const body = rpcBody(migration);
    // The client this very patch sets wins over the stored one, so linking a
    // task and switching the client in one call cannot slip past the check.
    assert.match(
        body,
        /when p_updates \? 'client_id' then v_client_id\s+else time_logs\.client_id\s+end\) is distinct from v_task_client_id/i,
    );
    assert.ok(
        body.search(/is distinct from v_task_client_id/i)
            < body.search(/update public\.time_logs as target/i),
        'the client match must be checked before the write',
    );
    assert.ok(
        body.search(/for update\s+\) as locked_targets/i)
            < body.search(/is distinct from v_task_client_id/i),
        'the rows must be locked before their client is read',
    );
});

test('task_id rides the existing single UPDATE and can be cleared', () => {
    const { migration } = sources();
    const body = rpcBody(migration);
    assert.match(
        body,
        /task_id = case\s+when p_updates \? 'task_id' then v_task_id\s+else target\.task_id\s+end,/i,
    );
    assert.equal(
        body.match(/update public\.time_logs as target/gi)?.length,
        1,
        'task_id must ride the existing single UPDATE, not a second one',
    );
    // An explicit JSON null leaves v_task_id null, so the CASE writes null:
    // clearing a link is a real edit, not a no-op.
    assert.match(body, /jsonb_typeof\(p_updates -> 'task_id'\) <> 'null'/i);
});

test('the superseding RPC keeps every earlier guard', () => {
    const { migration } = sources();
    const body = rpcBody(migration);
    assert.match(body, /security invoker/i);
    assert.match(body, /set search_path = ''/i);
    assert.match(body, /cardinality\(p_ids\) <> \(/i);
    assert.match(body, /for update\s+\) as locked_targets/i);
    assert.match(body, /timesheet_import_transition_conflict/);
    assert.match(body, /basecamp_project_roles\.role = 'internal'/);
    assert.match(body, /jsonb_typeof\(p_updates -> 'activity_keys'\) <> 'array'/i);
    assert.match(body, /array_position\(v_activity_keys, null\) is not null/i);
    assert.match(body, /jsonb_typeof\(link\.value -> 'url'\) is distinct from 'string'/i);
    assert.match(
        body,
        /revoke execute on function public\.apply_timesheet_import_transition/i,
    );
    assert.match(
        body,
        /grant execute on function public\.apply_timesheet_import_transition\(uuid, uuid\[\], uuid, text, jsonb\)\s+to service_role/i,
    );
});

test('044 removes nothing from the 043 definition it supersedes', () => {
    const applied = rpcBody(readFileSync(appliedRpcUrls[2], 'utf8')).split('\n');
    const superseding = rpcBody(sources().migration).split('\n');

    // Every line of the privileged 043 path must still appear, in order, in
    // 044. A dropped line is a dropped guard.
    let cursor = 0;
    for (const line of applied) {
        const found = superseding.indexOf(line, cursor);
        assert.ok(
            found >= 0,
            `migration 044 dropped a line from the 043 RPC: ${JSON.stringify(line)}`,
        );
        cursor = found + 1;
    }
});

test('schema.sql mirrors migration 044 verbatim', () => {
    const { migration, schema } = sources();
    assert.ok(
        schema.includes(migration.trim()),
        'schema.sql must contain migration 044 verbatim',
    );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migrationUrl = new URL(
    '../../migrations/041_atomic_timesheet_import_transitions.sql',
    import.meta.url,
);
const schemaUrl = new URL('../../schema.sql', import.meta.url);

function sources() {
    assert.ok(existsSync(migrationUrl), 'missing additive migration 041');
    return {
        migration: readFileSync(migrationUrl, 'utf8'),
        schema: readFileSync(schemaUrl, 'utf8'),
    };
}

function functionBody(sql: string): string {
    const match = sql.match(
        /create or replace function public\.apply_timesheet_import_transition\([\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
    );
    assert.ok(match, 'missing apply_timesheet_import_transition function');
    return match[1];
}

test('migration 041 is additive, mirrored, invoker-rights, and service-role only', () => {
    const { migration, schema } = sources();

    assert.doesNotMatch(migration, /drop table|drop column|truncate|delete from/i);
    for (const sql of [migration, schema]) {
        assert.match(sql, /create or replace function public\.apply_timesheet_import_transition/i);
        assert.match(sql, /security invoker/i);
        assert.match(
            sql,
            /revoke execute on function public\.apply_timesheet_import_transition\([^;]+from public, anon, authenticated/i,
        );
        assert.match(
            sql,
            /grant execute on function public\.apply_timesheet_import_transition\([^;]+to service_role/i,
        );
    }
});

test('the RPC locks and validates the exact organization, owner, status, and target set before update', () => {
    const { migration, schema } = sources();

    for (const sql of [migration, schema]) {
        const body = functionBody(sql);
        const lockAt = body.search(/from public\.time_logs[\s\S]+for update/i);
        const targetGuardAt = body.search(/v_target_count\s*<>\s*cardinality\(p_ids\)/i);
        const updateAt = body.search(/update public\.time_logs/i);

        assert.notEqual(lockAt, -1);
        assert.match(body, /time_logs\.organization_id\s*=\s*p_organization_id/i);
        assert.match(body, /time_logs\.import_status\s*=\s*p_expected_status/i);
        assert.match(
            body,
            /p_authorized_user_id is null\s+or\s+time_logs\.user_id\s*=\s*p_authorized_user_id/i,
        );
        assert.ok(lockAt < targetGuardAt, 'locked target count must be checked');
        assert.ok(targetGuardAt < updateAt, 'zero/partial target mismatches must abort before update');
    }
});

test('the RPC rejects a foreign client before update and rechecks the affected row count', () => {
    const { migration, schema } = sources();

    for (const sql of [migration, schema]) {
        const body = functionBody(sql);
        const clientGuardAt = body.search(/from public\.clients[\s\S]+clients\.organization_id\s*=\s*p_organization_id/i);
        const clientLockAt = body.search(/from public\.clients[\s\S]+for key share/i);
        const updateAt = body.search(/update public\.time_logs/i);
        const rowCountAt = body.search(/get diagnostics v_changed_count\s*=\s*row_count/i);
        const changedGuardAt = body.search(/v_changed_count\s*<>\s*cardinality\(p_ids\)/i);

        assert.notEqual(clientGuardAt, -1);
        assert.notEqual(clientLockAt, -1);
        assert.ok(clientGuardAt < updateAt, 'client ownership must be checked before update');
        assert.ok(clientLockAt < updateAt, 'validated client ownership must remain stable through update');
        assert.ok(updateAt < rowCountAt, 'the RPC must inspect the actual update count');
        assert.ok(rowCountAt < changedGuardAt, 'partial updates must raise and roll back');
        assert.match(body, /raise exception 'timesheet_import_transition_conflict'/i);
    }
});

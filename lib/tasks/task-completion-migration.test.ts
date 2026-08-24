import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../migrations/036_task_completion_time.sql', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

function functionBody(sql: string): string {
  const match = sql.match(
    /create or replace function public\.log_task_completion_time\([\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
  );
  assert.ok(match, 'missing log_task_completion_time function');
  return match[1];
}

test('completion-time migration is additive, idempotent, and mirrored', () => {
  for (const sql of [migration, schema]) {
    assert.match(sql, /add column if not exists completion_operation_id uuid/i);
    assert.match(
      sql,
      /create unique index if not exists time_logs_completion_operation_unique[\s\S]+where completion_operation_id is not null/i,
    );
    assert.match(sql, /create or replace function public\.log_task_completion_time/i);
  }
  assert.doesNotMatch(migration, /drop table|drop column/i);
});

test('completion logging derives the actor and verifies task membership', () => {
  for (const sql of [migration, schema]) {
    const body = functionBody(sql);
    assert.match(body, /actor_id uuid := auth\.uid\(\)/i);
    assert.match(body, /organization_members\.organization_id = owned_task\.organization_id/i);
    assert.match(body, /organization_members\.user_id = actor_id/i);
    assert.match(body, /owned_task\.status = 'done'/i);
  }
});

test('operation retries serialize before returning or inserting time', () => {
  for (const sql of [migration, schema]) {
    const body = functionBody(sql);
    const lockAt = body.search(/pg_advisory_xact_lock[\s\S]+p_operation_id/i);
    const existingAt = body.search(/completion_operation_id = p_operation_id/i);
    const insertAt = body.search(/insert into public\.time_logs/i);
    assert.notEqual(lockAt, -1);
    assert.ok(lockAt < existingAt, 'operation lock must precede retry lookup');
    assert.ok(existingAt < insertAt, 'retry lookup must precede insertion');
  }
});

test('completion time writes an exact segment and uses client-safe billing flags', () => {
  for (const sql of [migration, schema]) {
    const body = functionBody(sql);
    assert.match(body, /segment_end := segment_start \+ make_interval\(mins => p_minutes\)/i);
    assert.match(body, /insert into public\.time_log_segments/i);
    assert.match(
      body,
      /owned_task\.title,\s+owned_task\.client_id is not null,\s+owned_task\.client_id is not null,\s+'logged'/i,
    );
  }
});

test('completion logging is executable only by authenticated users', () => {
  assert.match(
    migration,
    /revoke execute on function public\.log_task_completion_time[^;]+from public, anon/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.log_task_completion_time[^;]+to authenticated/i,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../migrations/033_planner_time_segments.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

test('segment migration is additive, tenant-scoped, and mirrored', () => {
  for (const sql of [migration, schema]) {
    assert.match(sql, /create table(?: if not exists)? public\.time_log_segments/i);
    assert.match(sql, /where ended_at is null/i);
    assert.match(sql, /alter table public\.time_log_segments enable row level security/i);
    assert.match(sql, /planned_starts_at/i);
    assert.match(sql, /operation_id/i);
    assert.match(sql, /alter table public\.client_activity_log[\s\S]+operation_id/i);
  }
  assert.doesNotMatch(migration, /drop table|drop column/i);
});

test('timer RPC execution is not granted to anon', () => {
  assert.match(migration, /revoke execute on function public\.start_task_timer[^;]+ from public, anon/i);
  assert.match(migration, /grant execute on function public\.start_task_timer[^;]+ to authenticated/i);
});

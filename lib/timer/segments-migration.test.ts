import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../migrations/033_planner_time_segments.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

function functionBody(sql: string, name: string): string {
  const match = sql.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
    'i',
  ));
  assert.ok(match, `missing ${name} function`);
  return match[1];
}

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

test('start requires task assignment ownership and atomically claims unassigned tasks', () => {
  for (const sql of [migration, schema]) {
    const start = functionBody(sql, 'start_task_timer');
    assert.match(start, /owned_task\.assignee_id\s*=\s*actor_id/i);
    assert.match(start, /actor_id\s*=\s*any\s*\(owned_task\.assignee_ids\)/i);
    assert.match(start, /owned_task\.assignee_id is null[\s\S]+cardinality\(owned_task\.assignee_ids\)\s*=\s*0/i);
    assert.match(start, /update public\.tasks[\s\S]+assignee_id\s*=\s*actor_id[\s\S]+assignee_ids\s*=\s*array\[actor_id\]/i);
  }
});

test('parent time logs cannot change tenant or owner while segments exist', () => {
  for (const sql of [migration, schema]) {
    const parentGuard = functionBody(sql, 'protect_segmented_time_log_parent');
    assert.match(parentGuard, /new\.organization_id is distinct from old\.organization_id/i);
    assert.match(parentGuard, /new\.user_id is distinct from old\.user_id/i);
    assert.match(parentGuard, /exists\s*\([\s\S]+public\.time_log_segments/i);
    assert.match(sql, /before update of organization_id, user_id[\s\S]+on public\.time_logs[\s\S]+protect_segmented_time_log_parent/i);
  }
});

test('finalization serializes operation UUID reuse before checking availability', () => {
  for (const sql of [migration, schema]) {
    const finalize = functionBody(sql, 'finalize_time_attempt');
    const lockAt = finalize.search(/pg_advisory_xact_lock\s*\([\s\S]+p_operation_id/i);
    const availabilityAt = finalize.search(/operation identifier is already in use/i);
    assert.notEqual(lockAt, -1);
    assert.ok(lockAt < availabilityAt, 'operation lock must precede reuse check');
  }
});

test('review and finalization reject timestamps before the latest closed segment', () => {
  for (const sql of [migration, schema]) {
    const review = functionBody(sql, 'begin_stop_review');
    assert.match(review, /max\(time_log_segments\.ended_at\)[\s\S]+p_reviewing_at\s*<\s*latest_ended_at/i);

    const finalize = functionBody(sql, 'finalize_time_attempt');
    assert.match(finalize, /max\(time_log_segments\.ended_at\)/i);
    assert.match(finalize, /attempt\.reviewing_at\s*<\s*latest_ended_at/i);
    assert.match(finalize, /p_finalized_at\s*<\s*latest_ended_at/i);
  }
});

test('pause resume and task switch return canonical state only for exact retries', () => {
  for (const sql of [migration, schema]) {
    const pause = functionBody(sql, 'pause_time_attempt');
    assert.match(pause, /latest_ended_at is not distinct from p_paused_at/i);
    assert.match(pause, /attempt\.reviewing_at is null/i);

    const resume = functionBody(sql, 'resume_time_attempt');
    assert.match(resume, /open_segment\.started_at is not distinct from p_resumed_at/i);
    assert.match(resume, /attempt\.timer_started_at is not distinct from p_resumed_at/i);
    assert.match(resume, /not exists\s*\([\s\S]+ended_at\s*>\s*p_resumed_at/i);

    const switchAttempt = functionBody(sql, 'switch_time_attempt');
    assert.match(switchAttempt, /time_log_segments\.started_at\s*=\s*p_switched_at/i);
    assert.match(switchAttempt, /time_logs\.task_id\s*=\s*p_to_task_id/i);
    assert.match(switchAttempt, /not exists\s*\([\s\S]+ended_at\s*>\s*p_switched_at/i);
  }
});

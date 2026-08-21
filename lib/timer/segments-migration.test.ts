import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../migrations/033_planner_time_segments.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
// 033 is applied in production; 034 replaces start_task_timer in place.
const startTimerFix = readFileSync(new URL('../../migrations/034_start_timer_without_project.sql', import.meta.url), 'utf8');

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
  for (const name of [
    'start_task_timer',
    'pause_time_attempt',
    'resume_time_attempt',
    'switch_time_attempt',
    'begin_stop_review',
    'finalize_time_attempt',
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke execute on function public\\.${name}[^;]+ from public, anon`, 'i'),
      `${name} must be revoked from anon`,
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${name}[^;]+ to authenticated`, 'i'),
      `${name} must be granted to authenticated`,
    );
    assert.match(functionBody(migration, name), /auth\.uid\(\)/i, `${name} must derive its actor`);
  }
  // The segment tenant guard is trigger-only; nobody may call it directly.
  assert.doesNotMatch(migration, /grant execute on function public\.protect_/i);
});

test('one open segment per organization member is a database invariant, not a UI rule', () => {
  for (const sql of [migration, schema]) {
    assert.match(
      sql,
      /create unique index(?: if not exists)? one_open_time_segment_per_user\s+on public\.time_log_segments \(organization_id, user_id\)\s+where ended_at is null/i,
    );
    // Paused attempts are segmentless or fully closed, so nothing caps their number.
    assert.doesNotMatch(sql, /unique index[^;]+time_log_segments \(organization_id, user_id\);/i);
  }
});

test('legacy rows are migrated without inventing history', () => {
  assert.match(migration, /status = 'in_progress'[\s\S]{0,400}timer_started_at is not null/i);
  assert.match(migration, /not exists[\s\S]{0,300}time_log_segments/i);
  assert.doesNotMatch(migration, /insert into public\.time_log_segments[\s\S]{0,600}ended_at\s*\)?\s*values[\s\S]{0,200}now\(\)/i);
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

test('segment parent identity uses a composite foreign key to serialize both mutation directions', () => {
  for (const sql of [migration, schema]) {
    assert.match(
      sql,
      /alter table public\.time_logs\s+add constraint time_logs_segment_parent_key\s+unique\s*\(id, organization_id, user_id\)/i,
    );
    assert.match(
      sql,
      /alter table public\.time_log_segments\s+add constraint time_log_segments_parent_identity_fkey\s+foreign key\s*\(time_log_id, organization_id, user_id\)\s+references public\.time_logs\s*\(id, organization_id, user_id\)/i,
    );
  }
});

test('task-target switch retry locks target owner and segment before canonical validation', () => {
  for (const sql of [migration, schema]) {
    const switchAttempt = functionBody(sql, 'switch_time_attempt');
    const attemptLockAt = switchAttempt.search(/for update of time_logs/i);
    const ownerLockAt = switchAttempt.search(/hashtextextended\(active_attempt\.organization_id::text[\s\S]+actor_id::text/i);
    const segmentLockAt = switchAttempt.search(/into target_segment[\s\S]+for update/i);
    const canonicalAt = switchAttempt.search(/Exact switch retry/i);

    assert.notEqual(attemptLockAt, -1);
    assert.ok(attemptLockAt < ownerLockAt, 'target row lock must precede target owner lock');
    assert.ok(ownerLockAt < segmentLockAt, 'target owner lock must precede target segment lock');
    assert.ok(segmentLockAt < canonicalAt, 'all target locks must precede canonical validation');
  }
});

test('task-target switch retry locks and revalidates current target membership', () => {
  for (const sql of [migration, schema]) {
    const switchAttempt = functionBody(sql, 'switch_time_attempt');
    assert.match(
      switchAttempt,
      /from public\.organization_members[\s\S]+organization_members\.organization_id\s*=\s*active_attempt\.organization_id[\s\S]+organization_members\.user_id\s*=\s*actor_id[\s\S]+for key share/i,
    );
    assert.match(switchAttempt, /actor is no longer a member of the switch target organization/i);
  }
});

test('task-target switch retry locks assignment row against concurrent revocation', () => {
  for (const sql of [migration, schema]) {
    const switchAttempt = functionBody(sql, 'switch_time_attempt');
    assert.match(
      switchAttempt,
      /select tasks\.\*[\s\S]+into target_task[\s\S]+from public\.tasks[\s\S]+tasks\.id\s*=\s*p_to_task_id[\s\S]+tasks\.organization_id\s*=\s*active_attempt\.organization_id[\s\S]+for share;/i,
    );
  }
});

test('a task with no project can still start a timer', () => {
  // tasks.project_id was made nullable by migration 014 because tasks are
  // created from the client page without a project. Requiring a project row
  // unconditionally made Start fail for every such task.
  for (const sql of [startTimerFix, schema]) {
    const start = functionBody(sql, 'start_task_timer');
    const projectLookup = start.indexOf('from public.projects');
    assert.ok(projectLookup > -1, 'start must still validate a present project');
    const guard = start.lastIndexOf('project_id is not null', projectLookup);
    assert.ok(
      guard > -1,
      'start_task_timer must only resolve a project when the task has one',
    );
    assert.match(
      start.slice(guard),
      /task project is outside the task organization/i,
      'the project-tenant guard must live inside the not-null branch',
    );
  }
});

test('the applied 033 start function is superseded, never edited in place', () => {
  assert.match(startTimerFix, /create or replace function public\.start_task_timer/i);
  assert.match(
    startTimerFix,
    /revoke execute on function public\.start_task_timer[^;]+ from public, anon/i,
  );
  assert.match(
    startTimerFix,
    /grant execute on function public\.start_task_timer[^;]+ to authenticated/i,
  );
  assert.doesNotMatch(startTimerFix, /drop table|drop column|drop function/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migrationUrl = new URL('../../migrations/047_atomic_planner_task_unschedule.sql', import.meta.url);
const schemaUrl = new URL('../../schema.sql', import.meta.url);

test('planner task unscheduling is atomic, authenticated, and retry-safe', () => {
    assert.equal(existsSync(migrationUrl), true, 'migration 047 must exist');
    const migration = readFileSync(migrationUrl, 'utf8');

    assert.doesNotMatch(
        migration,
        /delete\s+from\s+public\.planner_priorities/i,
        'the migration must never delete existing priority rows',
    );
    assert.match(migration, /create unique index[^;]+planner_priorities[^;]+task_id/is);
    assert.match(migration, /create or replace function public\.unschedule_planner_task\(/i);
    assert.match(migration, /security invoker/i);
    assert.match(migration, /auth\.uid\(\)/i);
    assert.match(migration, /from public\.tasks[\s\S]+for update/i);
    assert.match(migration, /set start_date = null,[\s\S]+scheduled_minutes = null/i);
    assert.match(migration, /insert into public\.planner_priorities/i);
    assert.match(
        migration,
        /pg_advisory_xact_lock[\s\S]+max\(priorities\.sort_order\)/i,
        'priority ordering must be serialized before choosing the next sort order',
    );
    assert.match(migration, /on conflict \(organization_id, user_id, task_id\)[\s\S]+do nothing/i);
    assert.match(migration, /revoke execute[^;]+from public, anon/i);
    assert.match(migration, /grant execute[^;]+to authenticated/i);
});

test('schema snapshot mirrors the atomic planner task operation', () => {
    assert.equal(existsSync(migrationUrl), true, 'migration 047 must exist');
    const migration = readFileSync(migrationUrl, 'utf8').trim();
    const schema = readFileSync(schemaUrl, 'utf8');
    assert.equal(schema.includes(migration), true);
});

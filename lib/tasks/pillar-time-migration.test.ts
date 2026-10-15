import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../migrations/100_pillar_time_target.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

test('pillar time resolution is mirrored and does not rewrite service-role or recurring rows', () => {
    for (const sql of [migration, schema]) {
        assert.match(sql, /create or replace function public\.resolve_time_tracking_task_id\(p_task_id uuid\)/i);
        assert.match(sql, /child\.recurrence is null/i);
        assert.match(sql, /parent\.title is distinct from child\.title/i);
        assert.match(sql, /auth\.uid\(\) is null then p_task_id/i);
        assert.match(sql, /revoke all on function public\.resolve_time_tracking_task_id\(uuid\) from public, anon, authenticated/i);
        assert.match(sql, /create trigger prefer_pillar_on_time_log\s+before insert on public\.time_logs/i);
        assert.doesNotMatch(sql, /prefer_pillar_on_time_log[\s\S]{0,120}before insert or update/i);
        assert.match(sql, /tasks\.id = public\.resolve_time_tracking_task_id\(p_task_id\)/i);
    }
    assert.doesNotMatch(migration, /alter table public\.time_logs/i);
});

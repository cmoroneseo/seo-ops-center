import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('database rejects future and excessively old open timer segments', () => {
    const migration = readFileSync('migrations/048_guard_open_timer_start.sql', 'utf8');
    const schema = readFileSync('schema.sql', 'utf8');

    for (const sql of [migration, schema]) {
        assert.match(sql, /new\.started_at\s*>\s*clock_timestamp\(\)/i);
        assert.match(sql, /new\.started_at\s*<\s*clock_timestamp\(\)\s*-\s*interval\s+'24 hours'/i);
        assert.match(sql, /before insert or update of started_at, ended_at\s+on public\.time_log_segments/i);
    }
});

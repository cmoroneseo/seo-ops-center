import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('migration 137 and schema enforce one task per non-null Basecamp recording ID', () => {
    const migration = readFileSync(new URL('../../migrations/137_tasks_basecamp_recording_unique.sql', import.meta.url), 'utf8');
    const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

    assert.match(migration, /create unique index if not exists tasks_basecamp_recording_unique\s+on public\.tasks\s*\(basecamp_todo_id\)\s+where basecamp_todo_id is not null;/i);
    assert.ok(schema.includes(migration.trim()));
});

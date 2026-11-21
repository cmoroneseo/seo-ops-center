import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../../migrations/138_retire_task_stage.sql', import.meta.url), 'utf8');
const forward = migration.replace(/^--.*$/gm, '');

test('138 relaxes task stage storage without dropping the column or changing data', () => {
    assert.match(forward, /drop constraint if exists tasks_stage_check/);
    assert.match(forward, /alter column stage drop not null/);
    assert.match(forward, /alter column stage drop default/);
    assert.match(forward, /drop index if exists public\.tasks_client_stage_position_idx/);
    assert.doesNotMatch(forward, /drop\s+column|patch\.stage|task\.stage|set\s+stage/i);
    assert.match(forward, /set position = patch\.position/);
});

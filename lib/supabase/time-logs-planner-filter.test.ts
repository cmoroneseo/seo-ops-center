import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The planner and the task panel read `time_logs` directly rather than through
 * `getTimeLogs`, so they do not inherit its countable-time filter. When they
 * skipped it, a log voided at Basecamp stayed on the calendar while the
 * timesheet dropped it, and a day's hours no longer matched between the views.
 */
const source = readFileSync(new URL('./time-logs.ts', import.meta.url), 'utf8');

function bodyOf(name: string): string {
    const start = source.indexOf(`export async function ${name}(`);
    assert.notEqual(start, -1, `${name} not found`);
    const next = source.indexOf('\nexport ', start + 1);
    return source.slice(start, next === -1 ? undefined : next);
}

test('planner range query only reads countable logged time', () => {
    const body = bodyOf('getTimerAttemptsForRange');
    const logged = body.slice(body.indexOf(".eq('status', 'logged')"), body.indexOf(".eq('status', 'in_progress')"));
    assert.match(logged, /\.eq\('import_status', COUNTABLE_IMPORT_STATUS\)/);
});

test('task time log query only reads countable time', () => {
    assert.match(bodyOf('getTaskTimeLogs'), /\.eq\('import_status', COUNTABLE_IMPORT_STATUS\)/);
});

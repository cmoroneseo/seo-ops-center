import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the ledger opens a task with the query parameter the Tasks page reads', () => {
    const inspector = readFileSync(new URL('../../components/timesheets/LedgerInspector.tsx', import.meta.url), 'utf8');
    const tasks = readFileSync(new URL('../../app/(dashboard)/tasks/page.tsx', import.meta.url), 'utf8');

    assert.match(inspector, /\/tasks\?task=\$\{encodeURIComponent\(row\.taskId\)\}/);
    assert.match(tasks, /searchParams\.get\('task'\)/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the ledger opens a task with the query parameter the Tasks page reads', () => {
    const inspector = readFileSync(new URL('../../components/timesheets/LedgerInspector.tsx', import.meta.url), 'utf8');
    const tasks = readFileSync(new URL('../../app/(dashboard)/tasks/page.tsx', import.meta.url), 'utf8');

    assert.match(inspector, /\/tasks\?task=\$\{encodeURIComponent\(row\.taskId\)\}/);
    assert.match(tasks, /searchParams\.get\('task'\)/);
});

test('the inspector exposes paused edits only to managers through the trim route and shows audit', () => {
    const inspector = readFileSync(new URL('../../components/timesheets/LedgerInspector.tsx', import.meta.url), 'utf8');
    const shell = readFileSync(new URL('../../components/timesheets/TimesheetsShell.tsx', import.meta.url), 'utf8');
    const route = readFileSync(new URL('../../app/api/timesheets/ledger/[timeLogId]/trim/route.ts', import.meta.url), 'utf8');

    assert.match(inspector, /pausedBotTimer && entry.isBotTimer && onPausedTrimSaved/);
    assert.match(shell, /onPausedTrimSaved=\{isManager \? load : undefined\}/);
    assert.match(inspector, /Edit time/);
    assert.match(inspector, /role="alert"/);
    assert.match(inspector, /Trimmed from/);
    assert.match(inspector, /\/api\/timesheets\/ledger\/\$\{encodeURIComponent\(entry\.id\)\}\/trim/);
    assert.match(route, /getAuthenticatedActor/);
    assert.match(route, /savePausedTrim/);
    assert.doesNotMatch(route + inspector, /updateTimeLog|syncTimesheet|EditTimeLogSheet/);
});

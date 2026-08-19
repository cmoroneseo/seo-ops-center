import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(
    new URL('../app/api/integrations/basecamp/timesheet/route.ts', import.meta.url),
    'utf8',
);

test('Basecamp time-log mutations require membership in the owning organization', () => {
    assert.match(route, /async function canManageTimeLog/);
    assert.match(route, /\.eq\('user_id', userId\)/);
    assert.match(route, /if \(!await canManageTimeLog\(admin, user\.id, log\.organization_id\)\)/);
});

test('Basecamp entry removal requires a matching owned time log', () => {
    assert.match(route, /if \(!entryId \|\| !timeLogId\)/);
    assert.match(route, /existing\.basecamp_entry_id/);
    assert.match(route, /String\(existing\.basecamp_entry_id\) !== String\(entryId\)/);
});

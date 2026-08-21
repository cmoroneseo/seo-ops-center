import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(
    new URL('../app/api/integrations/basecamp/timesheet/route.ts', import.meta.url),
    'utf8',
);

test('Basecamp time-log mutations resolve the canonical log authorization before admin/provider work', () => {
    assert.match(route, /authorizeTimeLog: timeLogId => requireTimeLogIntegrationManager\(timeLogId\)/);
    assert.match(route, /createBasecampTimesheetPost/);
    assert.match(route, /performAuthorized\(body, context\)/);
});

test('Basecamp entry removal delegates only the authorized canonical entry ID', () => {
    assert.match(route, /deleteBasecampTimesheetEntry\(context\.entryId!\)/);
    assert.doesNotMatch(route, /deleteBasecampTimesheetEntry\(body\./);
});

test('Basecamp create is preceded by protected provenance adoption, never by caller-supplied entry IDs', () => {
    assert.match(route, /selectAdoptableTimesheetEntry\(/);
    assert.doesNotMatch(route, /selectAdoptableTimesheetEntry\([\s\S]{0,200}body\./);
    const adoptionIndex = route.indexOf('selectAdoptableTimesheetEntry(');
    const createIndex = route.indexOf('createBasecampTimesheetEntry(');
    assert.ok(adoptionIndex > -1 && createIndex > adoptionIndex);
});

test('adoption candidates and their existing claims are resolved from trusted server state', () => {
    assert.match(route, /listBasecampProjectTimesheetEntries\(/);
    assert.match(route, /claimedEntryIds/);
    assert.doesNotMatch(route, /basecamp_entry_id: body\./);
});

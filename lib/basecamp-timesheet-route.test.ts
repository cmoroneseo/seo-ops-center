import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(
    new URL('../app/api/integrations/basecamp/timesheet/route.ts', import.meta.url),
    'utf8',
);
const live = readFileSync(
    new URL('./basecamp/timesheet-live.ts', import.meta.url),
    'utf8',
);
const perform = readFileSync(
    new URL('./basecamp/timesheet-perform.ts', import.meta.url),
    'utf8',
);
const shared = `${live}\n${perform}`;

test('Basecamp time-log mutations resolve the canonical log authorization before admin/provider work', () => {
    assert.match(route, /timeLogId => requireTimeLogIntegrationManager\(timeLogId\)/);
    assert.match(live, /createBasecampTimesheetPost/);
    assert.match(perform, /performAuthorizedTimesheet\(/);
});

test('Basecamp entry removal delegates only the authorized canonical entry ID', () => {
    assert.match(perform, /deleteEntry\(context\.entryId!\)/);
    assert.match(live, /deleteBasecampTimesheetEntry\(entryId\)/);
    assert.doesNotMatch(shared, /deleteBasecampTimesheetEntry\(body\./);
    assert.doesNotMatch(perform, /deleteEntry\(body\./);
});

test('Basecamp create is preceded by protected provenance adoption, never by caller-supplied entry IDs', () => {
    assert.match(perform, /selectAdoptableTimesheetEntry\(/);
    assert.doesNotMatch(perform, /selectAdoptableTimesheetEntry\([\s\S]{0,200}body\./);
    const adoptionIndex = perform.indexOf('selectAdoptableTimesheetEntry(');
    const createIndex = perform.indexOf('io.createEntry(');
    assert.ok(adoptionIndex > -1 && createIndex > adoptionIndex);
});

test('adoption candidates and their existing claims are resolved from trusted server state', () => {
    assert.match(live, /listBasecampProjectTimesheetEntries\(/);
    assert.match(perform, /claimedEntryIds/);
    assert.doesNotMatch(shared, /basecamp_entry_id: body\./);
});

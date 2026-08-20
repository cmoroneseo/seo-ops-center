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
    assert.match(route, /deleteBasecampTimesheetEntry\(context\.recordingId!\)/);
    assert.doesNotMatch(route, /deleteBasecampTimesheetEntry\(body\./);
});

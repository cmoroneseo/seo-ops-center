import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../../app/api/activity/route.ts', import.meta.url), 'utf8');
const activity = readFileSync(new URL('../supabase/client-activity.ts', import.meta.url), 'utf8');

test('the browser activity route never forwards a caller-supplied correlation ID', () => {
    assert.doesNotMatch(route, /operationId[^\n]*=[^\n=]*body/);
    assert.doesNotMatch(route, /operationId:\s*(body|payload|metadata)/);
    assert.match(route, /const \{ clientId, eventType, metadata \} = body;/);
});

test('correlation lives in its own column rather than inside caller metadata', () => {
    assert.match(activity, /operation_id: payload\.operationId \?\? null/);
    assert.match(activity, /operationId: row\.operation_id \?\? undefined/);
    assert.doesNotMatch(activity, /metadata:\s*\{[^}]*operationId/);
});

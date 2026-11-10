/**
 * Run with: node --import tsx --test lib/reports/roadmap-server.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the public server path is the only service-role reader, and the block stays in the browser bundle without it', () => {
    const server = readFileSync(new URL('./roadmap-server.ts', import.meta.url), 'utf8');
    const block = readFileSync(new URL('../../components/reports/RoadmapReportBlock.tsx', import.meta.url), 'utf8');
    const view = readFileSync(new URL('../../components/reports/RoadmapReportView.tsx', import.meta.url), 'utf8');
    const route = readFileSync(new URL('../../app/api/reports/roadmap/[clientId]/route.ts', import.meta.url), 'utf8');
    assert.match(server, /createAdminClient/);
    assert.match(server, /readPublicRoadmap/);
    assert.doesNotMatch(server, /create policy|enable row level security/i);
    assert.doesNotMatch(block, /createAdminClient|SUPABASE_SERVICE_ROLE/);
    assert.doesNotMatch(view, /createAdminClient|SUPABASE_SERVICE_ROLE/);
    assert.doesNotMatch(route, /createAdminClient/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMyOverdueTaskCount } from './my-overdue-count';

test('the overdue badge reads an exact count of my open top-level tasks before today', async t => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sidebar-test.invalid';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
    const fetch = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input);
        assert.equal(url.pathname, '/rest/v1/tasks');
        assert.equal(init.method, 'HEAD');
        assert.equal(new Headers(init.headers).get('prefer'), 'count=exact');
        assert.deepEqual(Object.fromEntries(url.searchParams), {
            select: 'id',
            organization_id: 'eq.org',
            parent_task_id: 'is.null',
            assignee_ids: 'cs.{me}',
            or: '(status.neq.done,status.is.null)',
            due_date: 'lt.2026-11-21T00:00:00Z',
        });
        return new Response(null, { headers: { 'content-range': '*/6' } });
    });
    assert.equal(await getMyOverdueTaskCount('org', 'me', '2026-11-21'), 6);
    assert.equal(fetch.mock.callCount(), 1);
});

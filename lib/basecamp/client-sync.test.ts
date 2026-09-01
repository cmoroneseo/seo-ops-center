import test from 'node:test';
import assert from 'node:assert/strict';
import {
    requestTaskBasecampSync,
    requestTimeLogBasecampSync,
} from './client-sync.ts';

test('task conversion awaits the canonical task push response', async () => {
    // Catches returning success before Basecamp has answered or trusting caller project IDs.
    let request: { url: string; init?: RequestInit } | undefined;
    const result = await requestTaskBasecampSync('task-1', async (url, init) => {
        request = { url: String(url), init };
        return new Response(JSON.stringify({ success: true, todoId: 77 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    });

    assert.deepEqual(result, { success: true, providerId: '77' });
    assert.equal(request?.url, '/api/integrations/basecamp/push');
    assert.deepEqual(JSON.parse(String(request?.init?.body)), {
        action: 'create_todo',
        taskId: 'task-1',
    });
});

test('timesheet conversion reports the provider error instead of claiming success', async () => {
    // Catches the fire-and-forget path swallowing a failed Basecamp time entry.
    const result = await requestTimeLogBasecampSync('log-1', async () => (
        new Response(JSON.stringify({ success: false, error: 'Timesheet disabled' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
        })
    ));

    assert.deepEqual(result, { success: false, error: 'Timesheet disabled' });
});

test('a network failure is returned as a retryable sync failure', async () => {
    // Catches an unhandled rejection that would strand the modal in its saving state.
    const result = await requestTaskBasecampSync('task-1', async () => {
        throw new Error('offline');
    });

    assert.deepEqual(result, { success: false, error: 'offline' });
});

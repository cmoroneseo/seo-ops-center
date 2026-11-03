import assert from 'node:assert/strict';
import test from 'node:test';

import { rehomeProjectTimesheetEntries, type ProjectTimesheetLog, type RehomeTimesheetDeps } from './rehome-timesheet.ts';
import type { AdoptableTimesheetEntry } from './timesheet-post-route.ts';

const input = {
    taskId: 'task-1',
    organizationId: 'org-1',
    projectId: '202',
    todoId: '77',
};

function log(patch: Partial<ProjectTimesheetLog> = {}): ProjectTimesheetLog {
    return {
        id: 'log-1',
        entryId: '900',
        recordingId: '66',
        date: '2026-11-03',
        hours: 0.5,
        description: 'Reviewed redirects',
        personId: 9,
        ...patch,
    };
}

function harness(logs: ProjectTimesheetLog[], entries: AdoptableTimesheetEntry[] = []) {
    const calls: string[] = [];
    const claimed = new Set<string>();
    const deps: RehomeTimesheetDeps = {
        async listLogs() {
            return logs;
        },
        async projectTimesheetRecordingId() {
            return '66';
        },
        async listEntries() {
            return entries;
        },
        async claimedEntryIds() {
            return [...claimed];
        },
        async createEntry(recordingId, fields) {
            calls.push(`create:${recordingId}:${fields.date}:${fields.hours}:${fields.description ?? ''}`);
            return { id: 901 };
        },
        async deleteEntry(entryId) {
            calls.push(`delete:${entryId}`);
            return true;
        },
        async saveLink(saved) {
            calls.push(`save:${saved.logId}:${saved.previousEntryId}->${saved.entryId}@${saved.recordingId}`);
            return true;
        },
    };
    return { calls, claimed, deps, entries };
}

test('a project-timesheet entry is created on the to-do, the old entry is removed, then the row is updated', async () => {
    const { calls, deps } = harness([log()]);
    const result = await rehomeProjectTimesheetEntries(input, deps);
    assert.deepEqual(result, { moved: 1, failed: 0 });
    assert.deepEqual(calls, [
        'create:77:2026-11-03:0.5:Reviewed redirects',
        'delete:900',
        'save:log-1:900->901@77',
    ]);
});

test('an entry already on the to-do, or on some other recording, is left alone', async () => {
    const { calls, deps } = harness([
        log({ id: 'on-todo', entryId: '910', recordingId: '77' }),
        log({ id: 'other', entryId: '911', recordingId: '55' }),
    ]);
    const result = await rehomeProjectTimesheetEntries(input, deps);
    assert.deepEqual(result, { moved: 0, failed: 0 });
    assert.deepEqual(calls, []);
});

test('a lost create is adopted instead of duplicated, and a failed create does not delete the project entry', async () => {
    const existing: AdoptableTimesheetEntry[] = [{
        id: 901,
        date: '2026-11-03',
        hours: '0.50',
        description: 'Reviewed redirects',
        parent: { id: 77, type: 'Todo' },
    }];
    const adopted = harness([log()], existing);
    const adoptedResult = await rehomeProjectTimesheetEntries(input, adopted.deps);
    assert.deepEqual(adoptedResult, { moved: 1, failed: 0 });
    assert.deepEqual(adopted.calls, ['delete:900', 'save:log-1:900->901@77']);

    const failed = harness([log()]);
    failed.deps.createEntry = async () => null;
    const failedResult = await rehomeProjectTimesheetEntries(input, failed.deps);
    assert.deepEqual(failedResult, { moved: 0, failed: 1 });
    assert.deepEqual(failed.calls, []);
});

test('a delete failure leaves the local row pointed at the project entry', async () => {
    const { calls, deps } = harness([log()]);
    deps.deleteEntry = async entryId => {
        calls.push(`delete:${entryId}`);
        return false;
    };
    const result = await rehomeProjectTimesheetEntries(input, deps);
    assert.deepEqual(result, { moved: 0, failed: 1 });
    assert.deepEqual(calls, [
        'create:77:2026-11-03:0.5:Reviewed redirects',
        'delete:900',
    ]);
});

test('a second pass after the row points at the to-do does nothing', async () => {
    const { calls, deps } = harness([log({ entryId: '901', recordingId: '77' })]);
    const result = await rehomeProjectTimesheetEntries(input, deps);
    assert.deepEqual(result, { moved: 0, failed: 0 });
    assert.deepEqual(calls, []);
});

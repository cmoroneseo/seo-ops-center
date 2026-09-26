import test from 'node:test';
import assert from 'node:assert/strict';
import { stampPushedEntryIdentity } from './timesheet-push-identity.ts';
import { csvIdentityFor, type ProviderTimesheetEntry } from './timesheet-webhook-route.ts';
import { fingerprintFor } from './timesheet-csv.ts';

function entry(overrides: Partial<ProviderTimesheetEntry> = {}): ProviderTimesheetEntry {
    return {
        id: '10342115460',
        date: '2026-09-24',
        hours: 1.25,
        description: 'Internal Check In',
        updatedAt: '2026-09-25T16:54:52Z',
        bucketId: '37000001',
        parentId: '8528955745',
        parentType: 'Timesheet',
        creatorId: '44672223',
        personName: 'Carlos Morones',
        bucketName: 'SEO HQ',
        createdAt: '2026-09-25T16:54:51.123Z',
        ...overrides,
    };
}

test('stamps the same identity the CSV import computes for that entry', async () => {
    let written: string | null = null;
    const outcome = await stampPushedEntryIdentity({
        readEntry: async () => entry(),
        writeFingerprint: async fingerprint => { written = fingerprint; return null; },
    }, '37000001', '10342115460');

    assert.equal(outcome, 'stamped');
    // Parity with the CSV row for the same entry is the whole point.
    assert.equal(written, fingerprintFor({
        person: 'Carlos Morones',
        projectName: 'SEO HQ',
        date: '2026-09-24',
        hours: 1.25,
        created: '2026-09-25T16:54:51.123Z',
    }));
});

test('an entry Basecamp cannot return writes nothing', async () => {
    for (const result of ['missing', 'unavailable'] as const) {
        let wrote = false;
        const outcome = await stampPushedEntryIdentity({
            readEntry: async () => result,
            writeFingerprint: async () => { wrote = true; return null; },
        }, 'p', 'e');
        assert.equal(outcome, 'unavailable');
        assert.equal(wrote, false);
    }
});

test('an entry missing identity fields writes nothing rather than a weak hash', async () => {
    assert.equal(csvIdentityFor(entry({ personName: '' })), null);
    let wrote = false;
    const outcome = await stampPushedEntryIdentity({
        readEntry: async () => entry({ personName: '' }),
        writeFingerprint: async () => { wrote = true; return null; },
    }, 'p', 'e');
    assert.equal(outcome, 'unavailable');
    assert.equal(wrote, false);
});

test('a row already holding the identity is reported, not overwritten', async () => {
    const outcome = await stampPushedEntryIdentity({
        readEntry: async () => entry(),
        writeFingerprint: async () => '23505',
    }, 'p', 'e');
    assert.equal(outcome, 'conflict');
});

test('never throws: a failed read cannot fail the sync that preceded it', async () => {
    const outcome = await stampPushedEntryIdentity({
        readEntry: async () => { throw new Error('network'); },
        writeFingerprint: async () => null,
    }, 'p', 'e');
    assert.equal(outcome, 'failed');
});

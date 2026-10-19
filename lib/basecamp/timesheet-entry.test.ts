import test from 'node:test';
import assert from 'node:assert/strict';
import { csvIdentityFor, type ProviderTimesheetEntry } from './timesheet-entry.ts';
import { fingerprintFor, parseTimesheetCsv } from './timesheet-csv.ts';

function providerEntry(overrides: Partial<ProviderTimesheetEntry> = {}): ProviderTimesheetEntry {
    return {
        id: '9001',
        date: '2026-08-24',
        hours: 1.5,
        description: 'Keyword mapping',
        updatedAt: '2026-08-24T18:00:00Z',
        bucketId: '48599958',
        parentId: '777',
        parentType: 'Timesheet',
        creatorId: '55501',
        personName: 'Carlos Morones',
        bucketName: 'SEO Ops Sandbox (testing)',
        createdAt: '2026-08-24T17:59:12.409Z',
        ...overrides,
    };
}

// The CSV report and the live provider entry for one real Basecamp entry must
// land on one identity. Every literal below is the verified live shape of
// entry 10228422582 as each source reports it.

test('a CSV row and the live provider entry for the SAME entry fingerprint identically', () => {
    const csv = [
        'Date,Person,Hours,Project,Item,Notes,Created',
        '2026-08-21,Carlos Morones,2.0,SEO Ops Sandbox (testing),,,2026-08-21T21:46:54Z',
    ].join('\n');
    const [row] = parseTimesheetCsv(csv);
    assert.ok(row, 'the CSV fixture must parse');

    const entry = providerEntry({
        id: '10228422582',
        date: '2026-08-21',
        hours: Number('2.0'),
        personName: 'Carlos Morones',
        bucketName: 'SEO Ops Sandbox (testing)',
        createdAt: '2026-08-21T21:46:54.268Z',
    });

    assert.equal(csvIdentityFor(entry), fingerprintFor(row));
    assert.equal(csvIdentityFor(entry), '2c319e6d74e552544b2816255b41215b');
});

test('hours parity holds across every spelling Basecamp uses', () => {
    for (const [apiHours, csvHours] of [
        ['2', '2'], ['2.0', '2.0'], ['0.5', '0.5'],
        ['1.25', '1.25'], ['0.3', '0.3'],
    ]) {
        const [row] = parseTimesheetCsv([
            'Date,Person,Hours,Project,Item,Notes,Created',
            `2026-08-21,Carlos Morones,${csvHours},SEO Ops Sandbox (testing),,,2026-08-21T21:46:54Z`,
        ].join('\n'));
        const entry = providerEntry({
            date: '2026-08-21',
            hours: Number(apiHours),
            personName: 'Carlos Morones',
            bucketName: 'SEO Ops Sandbox (testing)',
            createdAt: '2026-08-21T21:46:54.268Z',
        });
        assert.equal(csvIdentityFor(entry), fingerprintFor(row), `hours ${apiHours}`);
    }

    assert.equal(
        csvIdentityFor(providerEntry({ hours: Number('2.0') })),
        csvIdentityFor(providerEntry({ hours: 2 })),
    );
});

test('created-at parity holds between millisecond and second precision', () => {
    assert.equal(
        csvIdentityFor(providerEntry({ createdAt: '2026-08-21T21:46:54.268Z' })),
        csvIdentityFor(providerEntry({ createdAt: '2026-08-21T21:46:54Z' })),
    );
});

test('no fingerprint is invented when the provider withholds a field the hash needs', () => {
    assert.equal(csvIdentityFor(providerEntry({ personName: '' })), null);
    assert.equal(csvIdentityFor(providerEntry({ bucketName: '' })), null);
    assert.equal(csvIdentityFor(providerEntry({ createdAt: '' })), null);
    assert.equal(csvIdentityFor(providerEntry({ date: '' })), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimesheetCsv, fingerprintFor } from './timesheet-csv.ts';

const HEADER = 'Date,Person,Hours,Project,Item,Notes,Created';

test('parses a real Basecamp export row', () => {
    const rows = parseTimesheetCsv([
        HEADER,
        '2026-08-16,Abel Miranda,2.0,The HR Innovator Group,,"Prepare notes for meeting, content pruning plan",2026-08-17T01:47:31Z',
    ].join('\n'));

    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
        date: '2026-08-16',
        person: 'Abel Miranda',
        hours: 2,
        projectName: 'The HR Innovator Group',
        item: '',
        notes: 'Prepare notes for meeting, content pruning plan',
        created: '2026-08-17T01:47:31Z',
    });
});

test('a quoted field may contain commas', () => {
    const rows = parseTimesheetCsv([
        HEADER,
        '2026-08-01,Abel Miranda,1.0,"Acme, Inc.",,"a, b, c",2026-08-01T10:00:00Z',
    ].join('\n'));

    assert.equal(rows[0].projectName, 'Acme, Inc.');
    assert.equal(rows[0].notes, 'a, b, c');
});

test('a quoted field may contain escaped quotes', () => {
    const rows = parseTimesheetCsv([
        HEADER,
        '2026-08-01,Abel Miranda,1.0,Acme,,"He said ""hi""",2026-08-01T10:00:00Z',
    ].join('\n'));

    assert.equal(rows[0].notes, 'He said "hi"');
});

test('empty notes and item are empty strings, never undefined', () => {
    const rows = parseTimesheetCsv([HEADER, '2026-08-03,Abel Miranda,0.5,SEO HQ,,"",2026-08-03T12:00:00Z'].join('\n'));

    assert.equal(rows[0].notes, '');
    assert.equal(rows[0].item, '');
});

test('project names containing the em dash and trademark survive', () => {
    const rows = parseTimesheetCsv([
        HEADER,
        '2026-08-04,Abel Miranda,6.5,DH Construction Growth OS – Powered by the Empire Method™,,"",2026-08-04T09:00:00Z',
    ].join('\n'));

    assert.equal(rows[0].projectName, 'DH Construction Growth OS – Powered by the Empire Method™');
});

test('a header-only export yields no rows', () => {
    assert.deepEqual(parseTimesheetCsv(HEADER), []);
    assert.deepEqual(parseTimesheetCsv(''), []);
    assert.deepEqual(parseTimesheetCsv('   \n  '), []);
});

test('malformed rows are skipped rather than importing garbage', () => {
    const rows = parseTimesheetCsv([
        HEADER,
        'not,enough',
        '2026-08-01,Abel Miranda,notanumber,Acme,,"",2026-08-01T10:00:00Z',
        '2026-08-01,Abel Miranda,1.0,Acme,,"",2026-08-01T10:00:00Z',
    ].join('\n'));

    assert.equal(rows.length, 1);
    assert.equal(rows[0].hours, 1);
});

test('a trailing newline does not produce a phantom row', () => {
    const rows = parseTimesheetCsv([HEADER, '2026-08-01,Abel,1.0,Acme,,"",2026-08-01T10:00:00Z', ''].join('\n'));
    assert.equal(rows.length, 1);
});

test('fingerprint is stable and distinguishes every real August row', () => {
    const row = {
        date: '2026-08-06', person: 'Abel Miranda', hours: 4.5,
        projectName: 'Scott Cole Plumbing', item: '', notes: '',
        created: '2026-08-07T19:51:38Z',
    };
    assert.equal(fingerprintFor(row), fingerprintFor({ ...row }));
    assert.notEqual(fingerprintFor(row), fingerprintFor({ ...row, hours: 4.6 }));
    assert.notEqual(fingerprintFor(row), fingerprintFor({ ...row, created: '2026-08-07T19:51:39Z' }));
    assert.notEqual(fingerprintFor(row), fingerprintFor({ ...row, projectName: 'Other' }));
    assert.notEqual(fingerprintFor(row), fingerprintFor({ ...row, date: '2026-08-07' }));
});

test('fingerprint ignores fields a person can edit after the fact', () => {
    const row = {
        date: '2026-08-06', person: 'Abel Miranda', hours: 4.5,
        projectName: 'Scott Cole Plumbing', item: '', notes: '',
        created: '2026-08-07T19:51:38Z',
    };
    // Notes get edited in Basecamp; identity must survive that.
    assert.equal(fingerprintFor(row), fingerprintFor({ ...row, notes: 'added later' }));
});

test('fingerprint is a short hex digest', () => {
    const row = {
        date: '2026-08-06', person: 'Abel', hours: 1,
        projectName: 'P', item: '', notes: '', created: '2026-08-06T10:00:00Z',
    };
    assert.match(fingerprintFor(row), /^[0-9a-f]{32}$/);
});

test('fingerprint does not collide when a separator character shifts between fields', () => {
    const base = {
        date: '2026-08-06', hours: 4.5, item: '', notes: '',
        created: '2026-08-07T19:51:38Z',
    };
    const rowA = { ...base, person: 'A|B', projectName: 'C' };
    const rowB = { ...base, person: 'A', projectName: 'B|C' };

    assert.notEqual(fingerprintFor(rowA), fingerprintFor(rowB));
});

test('a row with more than the expected number of fields is skipped, not misparsed', () => {
    const rows = parseTimesheetCsv([
        HEADER,
        '2026-08-01,Abel Miranda,1.0,Acme,,"",2026-08-01T10:00:00Z,extra,another',
    ].join('\n'));

    assert.equal(rows.length, 0);
});

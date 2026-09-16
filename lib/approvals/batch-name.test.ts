import test from 'node:test';
import assert from 'node:assert/strict';

import { batchNameHint, batchNameIssue, canUseBatchName } from './batch-name.ts';

test('an ordinary batch name is accepted', () => {
    assert.equal(batchNameIssue('October Content'), null);
    assert.equal(canUseBatchName('October Content'), true);
    assert.equal(batchNameHint(null), null);
});

test('a pasted Google Doc URL is rejected and explained', () => {
    // Exactly what the first real user did: the import field wants a URL, so a fresh
    // clipboard plus a text input beat the placeholder.
    const pasted = 'https://docs.google.com/document/d/1_tKQhG3G7oy1HC35wUzaG7T0fRtaoAPCot8tcFlTRfU/edit?tab=t.0#heading=h.hxyrrupa16lv';
    assert.equal(batchNameIssue(pasted), 'document_link');
    assert.equal(canUseBatchName(pasted), false);
    assert.match(batchNameHint('document_link')!, /paste the link into Import/i);
});

test('any other URL is rejected too, since the name is client-facing', () => {
    assert.equal(batchNameIssue('https://example.com/brief'), 'url');
    assert.equal(batchNameIssue('www.example.com'), 'url');
    assert.match(batchNameHint('url')!, /shown to the client/i);
});

test('empty and whitespace-only names are flagged as empty, not as errors to read', () => {
    assert.equal(batchNameIssue(''), 'empty');
    assert.equal(batchNameIssue('   '), 'empty');
    assert.equal(batchNameHint('empty'), null, 'the disabled button already says this');
    assert.equal(canUseBatchName(''), false);
});

test('a name that merely mentions a domain is not a link', () => {
    assert.equal(batchNameIssue('Kentina.com refresh — October'), null);
    assert.equal(batchNameIssue('Q4 content for docs.google.com migration'), null,
        'only a real document URL should trip the check');
});

test('the host must actually be docs.google.com, not merely appear in the string', () => {
    // CodeQL caught the original unanchored regex (js/regex/missing-regexp-anchor):
    // it matched any URL that merely contained the host anywhere.
    assert.equal(
        batchNameIssue('https://evil.example.com/?x=docs.google.com/document/d/abc'),
        'url',
        'a foreign host must not read as a Google Doc link',
    );
    assert.equal(
        batchNameIssue('https://docs.google.com.evil.example.com/document/d/abc'),
        'url',
        'a lookalike subdomain suffix must not read as a Google Doc link',
    );
    assert.equal(batchNameIssue('https://docs.google.com/spreadsheets/d/abc'), 'url',
        'a Sheets link is a URL, but not a document link');
});

test('a document link without a protocol is still caught', () => {
    assert.equal(batchNameIssue('docs.google.com/document/d/abc/edit'), 'document_link');
});

test('a one-word name is not mistaken for a host', () => {
    assert.equal(batchNameIssue('Newsletter'), null);
    assert.equal(batchNameIssue('October'), null);
});

test('surrounding whitespace does not hide a pasted link', () => {
    assert.equal(batchNameIssue('  https://docs.google.com/document/d/abc/edit  '), 'document_link');
});

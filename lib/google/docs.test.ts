import test from 'node:test';
import assert from 'node:assert/strict';

import {
    describeDocsFailure,
    extensionForContentType,
    IMPORT_SUGGESTIONS_VIEW_MODE,
} from './docs.ts';

test('imports use the one view mode that is both safe and read-only compatible', () => {
    // Verified live against the Docs API: with a Viewer grant, SUGGESTIONS_INLINE and
    // PREVIEW_SUGGESTIONS_ACCEPTED both return
    //   403 "You do not have permission to access the document suggestions"
    // while PREVIEW_WITHOUT_SUGGESTIONS returns 200. Requesting either of the first two
    // would force the service account to hold write access on every client document
    // just to read it. PREVIEW_WITHOUT_SUGGESTIONS also excludes un-accepted suggested
    // text, which is the property we actually needed.
    assert.equal(IMPORT_SUGGESTIONS_VIEW_MODE, 'PREVIEW_WITHOUT_SUGGESTIONS');
});

test('403 explains the actual fix — sharing with the service account', () => {
    const { message, hint } = describeDocsFailure(403, 'abc123');
    assert.match(message, /Access denied/);
    assert.match(hint, /service account/i);
    assert.match(hint, /Shared Drive/i);
});

test('a disabled Docs API is not reported as a sharing problem', () => {
    // Both arrive as 403 PERMISSION_DENIED, and the fixes are unrelated. This exact
    // payload came back from a freshly created project during live setup, where the old
    // handler told the user to share a document that was never the problem.
    const body = {
        error: {
            status: 'PERMISSION_DENIED',
            message: 'Google Docs API has not been used in project 1061002382886 before or it is disabled. Enable it by visiting ... then retry.',
            details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED' }],
        },
    };
    const { message, hint } = describeDocsFailure(403, 'abc123', body);
    assert.match(message, /not enabled/i);
    assert.match(hint, /Enable the Google Docs API/i);
    assert.doesNotMatch(hint, /Share the document/i, 'must not send the user to fix sharing');
});

test('SERVICE_DISABLED is detected from the message alone when details are absent', () => {
    const { message } = describeDocsFailure(403, 'abc', {
        error: { message: 'Google Docs API has not been used in project 123 before or it is disabled.' },
    });
    assert.match(message, /not enabled/i);
});

test('a genuine sharing 403 still reads as a sharing problem', () => {
    const body = {
        error: {
            status: 'PERMISSION_DENIED',
            message: 'The caller does not have permission',
            details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
        },
    };
    const { hint } = describeDocsFailure(403, 'abc', body);
    assert.match(hint, /Share the document/i);
});

test('401 points at the env var, which is where this actually goes wrong', () => {
    const { hint } = describeDocsFailure(401, 'abc123');
    assert.match(hint, /GOOGLE_SERVICE_ACCOUNT_JSON/);
});

test('404 and 429 read as distinct, actionable failures', () => {
    assert.match(describeDocsFailure(404, 'abc').message, /not found/i);
    assert.match(describeDocsFailure(429, 'abc').message, /rate limit/i);
    assert.match(describeDocsFailure(500, 'abc').message, /500/);
});

test('every failure carries a hint, so no status is a dead end', () => {
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
        const { message, hint } = describeDocsFailure(status, 'abc');
        assert.ok(message.length > 0, `status ${status} needs a message`);
        assert.ok(hint.length > 0, `status ${status} needs a hint`);
    }
});

test('extensionForContentType maps real types and falls back safely', () => {
    assert.equal(extensionForContentType('image/png'), 'png');
    assert.equal(extensionForContentType('image/jpeg'), 'jpg');
    assert.equal(extensionForContentType('image/webp'), 'webp');
    assert.equal(extensionForContentType('image/svg+xml'), 'svg');
    assert.equal(extensionForContentType('image/PNG'), 'png', 'case-insensitive');
    assert.equal(extensionForContentType('image/jpeg; charset=binary'), 'jpg', 'parameters ignored');
    assert.equal(extensionForContentType('application/octet-stream'), 'png', 'safe fallback');
});

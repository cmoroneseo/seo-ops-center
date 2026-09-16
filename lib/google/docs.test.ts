import test from 'node:test';
import assert from 'node:assert/strict';

import {
    describeDocsFailure,
    extensionForContentType,
    IMPORT_SUGGESTIONS_VIEW_MODE,
} from './docs.ts';

test('imports always pass suggestionsViewMode explicitly', () => {
    // The API default is SUGGESTIONS_INLINE. Relying on a default that folds un-accepted
    // suggestions into the text is how a client ends up reviewing copy nobody approved,
    // so the value is pinned here and asserted.
    assert.equal(IMPORT_SUGGESTIONS_VIEW_MODE, 'SUGGESTIONS_INLINE');
});

test('403 explains the actual fix — sharing with the service account', () => {
    const { message, hint } = describeDocsFailure(403, 'abc123');
    assert.match(message, /Access denied/);
    assert.match(hint, /service account/i);
    assert.match(hint, /Shared Drive/i);
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

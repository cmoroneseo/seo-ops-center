import test from 'node:test';
import assert from 'node:assert/strict';

import { keywordTrackingEnabled } from './flag.ts';

test('keyword tracking is off unless the flag is exactly true', () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    try {
        delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        assert.equal(keywordTrackingEnabled(), false);
        process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'false';
        assert.equal(keywordTrackingEnabled(), false);
        process.env.NEXT_PUBLIC_KEYWORD_TRACKING = '1';
        assert.equal(keywordTrackingEnabled(), false);
        process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'TRUE';
        assert.equal(keywordTrackingEnabled(), false);
        process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
        assert.equal(keywordTrackingEnabled(), true);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

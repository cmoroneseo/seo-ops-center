import test from 'node:test';
import assert from 'node:assert/strict';

import { searchReportingEnabled } from './flag.ts';

test('search reporting is off unless the flag is exactly true', () => {
    const previous = process.env.NEXT_PUBLIC_SEARCH_REPORTING;
    try {
        delete process.env.NEXT_PUBLIC_SEARCH_REPORTING;
        assert.equal(searchReportingEnabled(), false);
        process.env.NEXT_PUBLIC_SEARCH_REPORTING = '1';
        assert.equal(searchReportingEnabled(), false);
        process.env.NEXT_PUBLIC_SEARCH_REPORTING = 'TRUE';
        assert.equal(searchReportingEnabled(), false);
        process.env.NEXT_PUBLIC_SEARCH_REPORTING = 'true';
        assert.equal(searchReportingEnabled(), true);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_SEARCH_REPORTING;
        else process.env.NEXT_PUBLIC_SEARCH_REPORTING = previous;
    }
});

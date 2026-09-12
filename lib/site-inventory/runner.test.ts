import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSiteCrawlBatchSize } from './runner.ts';

test('defaults each serverless request to one sequential URL', () => {
    assert.equal(normalizeSiteCrawlBatchSize(), 1);
});

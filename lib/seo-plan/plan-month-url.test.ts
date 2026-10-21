import assert from 'node:assert/strict';
import test from 'node:test';

import { hrefWithOverviewMonth, readOverviewMonth } from './plan-month-url.ts';

test('overviewMonth is read only when it is a calendar month', () => {
    assert.equal(readOverviewMonth('?overviewMonth=2026-11&tab=campaign'), '2026-11');
    assert.equal(readOverviewMonth('tab=campaign&overviewMonth=2026-11'), '2026-11');
    assert.equal(readOverviewMonth('?overviewMonth=2026-13'), null);
    assert.equal(readOverviewMonth('?overviewMonth=November'), null);
    assert.equal(readOverviewMonth(''), null);
});

test('changing month writes overviewMonth and keeps the other params', () => {
    const next = hrefWithOverviewMonth('/workspace/floor?tab=campaign&overviewTask=abc', '2026-12');
    assert.equal(next, '/workspace/floor?tab=campaign&overviewTask=abc&overviewMonth=2026-12');
    const replaced = hrefWithOverviewMonth('/workspace/floor?overviewMonth=2026-10&tab=campaign', '2026-11');
    assert.equal(readOverviewMonth(replaced.split('?')[1] ?? ''), '2026-11');
    assert.match(replaced, /tab=campaign/);
});

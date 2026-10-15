import test from 'node:test';
import assert from 'node:assert/strict';
import { GA4_HISTORY_SANDBOX_ORG_ID, ga4BackfillEnabled, ga4HistoryEnabled, ga4OrgAllowlist } from './flags.ts';

const OTHER = '11111111-1111-4111-8111-111111111111';

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
    return values as NodeJS.ProcessEnv;
}

test('GA4 history stays off unless the flag is exactly true and the org is allowlisted', () => {
    assert.equal(ga4HistoryEnabled(env({}), GA4_HISTORY_SANDBOX_ORG_ID), false);
    assert.equal(ga4HistoryEnabled(env({ GA4_HISTORY_ENABLED: '1', GA4_ORG_IDS: GA4_HISTORY_SANDBOX_ORG_ID }), GA4_HISTORY_SANDBOX_ORG_ID), false);
    assert.equal(ga4HistoryEnabled(env({ GA4_HISTORY_ENABLED: 'true' }), GA4_HISTORY_SANDBOX_ORG_ID), false);
    assert.equal(ga4HistoryEnabled(env({ GA4_HISTORY_ENABLED: 'true', GA4_ORG_IDS: 'nope' }), GA4_HISTORY_SANDBOX_ORG_ID), false);
    assert.equal(ga4HistoryEnabled(env({
        GA4_HISTORY_ENABLED: 'true',
        GA4_ORG_IDS: ` ${GA4_HISTORY_SANDBOX_ORG_ID.toUpperCase()} , not-a-uuid `,
    }), GA4_HISTORY_SANDBOX_ORG_ID), true);
    assert.equal(ga4HistoryEnabled(env({
        GA4_HISTORY_ENABLED: 'true',
        GA4_ORG_IDS: GA4_HISTORY_SANDBOX_ORG_ID,
    }), OTHER), false);
    assert.equal(ga4HistoryEnabled(env({ GA4_HISTORY_ENABLED: 'true', GA4_ORG_IDS: GA4_HISTORY_SANDBOX_ORG_ID })), false);
    assert.deepEqual(ga4OrgAllowlist(env({})), []);
    assert.deepEqual(ga4OrgAllowlist(env({ GA4_HISTORY_ENABLED: 'true' })), []);
});

test('backfill stays off unless history and the backfill flag are both exactly true', () => {
    const listed = { GA4_HISTORY_ENABLED: 'true', GA4_ORG_IDS: GA4_HISTORY_SANDBOX_ORG_ID };
    assert.equal(ga4BackfillEnabled(env(listed), GA4_HISTORY_SANDBOX_ORG_ID), false);
    assert.equal(ga4BackfillEnabled(env({ ...listed, GA4_BACKFILL_ENABLED: 'TRUE' }), GA4_HISTORY_SANDBOX_ORG_ID), false);
    assert.equal(ga4BackfillEnabled(env({ GA4_BACKFILL_ENABLED: 'true', GA4_ORG_IDS: GA4_HISTORY_SANDBOX_ORG_ID }), GA4_HISTORY_SANDBOX_ORG_ID), false);
    assert.equal(ga4BackfillEnabled(env({ ...listed, GA4_BACKFILL_ENABLED: 'true' }), GA4_HISTORY_SANDBOX_ORG_ID), true);
    assert.equal(ga4BackfillEnabled(env({ ...listed, GA4_BACKFILL_ENABLED: 'true' }), OTHER), false);
});

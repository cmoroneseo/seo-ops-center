import assert from 'node:assert/strict';
import test from 'node:test';

import { basecampSendHint, manualTimeDefaults, manualTimeWrite } from './manual-entry.ts';

test('a manual entry starts billable and counts toward SEO hours', () => {
    const defaults = manualTimeDefaults();
    assert.deepEqual(defaults, { billable: true, countsTowardBudget: true });
    assert.deepEqual(manualTimeWrite(defaults, { clientId: 'client-1', basecampEligible: true }), {
        billable: true,
        countsTowardBudget: true,
        syncToBasecamp: true,
    });
});

test('turning a toggle off is what gets saved, and a client without Basecamp is not sent', () => {
    const saved = manualTimeWrite({
        billable: false,
        countsTowardBudget: false,
        sendOverride: true,
    }, { clientId: 'client-1', basecampEligible: false });
    assert.deepEqual(saved, { billable: false, countsTowardBudget: false, syncToBasecamp: false });

    assert.equal(manualTimeWrite({
        ...manualTimeDefaults(),
        sendOverride: false,
    }, { clientId: 'client-1', basecampEligible: true }).syncToBasecamp, false);
    assert.equal(manualTimeWrite(manualTimeDefaults(), {
        clientId: 'client-1',
        basecampEligible: true,
    }).syncToBasecamp, true);
});

test('internal work does not consume SEO hours or a Basecamp timesheet', () => {
    const saved = manualTimeWrite(manualTimeDefaults(), { clientId: null, basecampEligible: false });
    assert.equal(saved.countsTowardBudget, false);
    assert.equal(saved.syncToBasecamp, false);
    assert.equal(saved.billable, true);
    assert.match(basecampSendHint({ clientId: null, checking: false, eligible: false }), /Select a client/);
    assert.match(basecampSendHint({ clientId: 'client-1', checking: false, eligible: false }), /not set up/);
    assert.match(basecampSendHint({ clientId: 'client-1', checking: false, eligible: true }), /project timesheet/);
});

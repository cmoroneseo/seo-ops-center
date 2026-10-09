import test from 'node:test';
import assert from 'node:assert/strict';

import { STATES_COPY, notConnectedPresentation, snapshotLocked, staleAsOf } from './states-copy.ts';

test('states-matrix copy stays on the reviewed sentences', () => {
    assert.equal(STATES_COPY.fresh, 'Fresh');
    assert.equal(STATES_COPY.notConnected, 'Not connected');
    assert.equal(STATES_COPY.missingValue, '—');
    assert.equal(STATES_COPY.emptyValue, '0');
    assert.equal(STATES_COPY.empty, 'A real zero for this window.');
    assert.equal(STATES_COPY.missing, 'No data for this window.');
    assert.equal(STATES_COPY.partialHistory, "History doesn't cover this window.");
    assert.equal(STATES_COPY.partialBackfill, 'The backfill is still running.');
    assert.equal(STATES_COPY.staleGsc, 'Search Console data is more than 36 hours old.');
    assert.equal(STATES_COPY.staleGbp, 'Business Profile data is more than 72 hours old.');
    assert.equal(STATES_COPY.staleDfs, 'This snapshot is more than 7 days old.');
    assert.equal(STATES_COPY.staleDefault, 'Data is more than 36 hours old.');
    assert.equal(STATES_COPY.staleError, 'The last sync errored.');
    assert.equal(STATES_COPY.noSuccessfulSync, 'No successful sync yet.');
    assert.equal(STATES_COPY.prelimTag, 'prelim');
    assert.equal(STATES_COPY.snapshotTag, 'snapshot');
    assert.equal(STATES_COPY.refTag, 'ref');
    assert.equal(staleAsOf('Oct 8, 2026'), 'as of Oct 8, 2026');
    assert.equal(snapshotLocked('Oct 2, 2026'), 'Snapshot locked Oct 2, 2026');
    assert.equal(
        notConnectedPresentation("Search Console isn't connected."),
        "— Search Console isn't connected.",
    );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { isProviderOriginated, refuseProviderCreate } from './provider-origin.ts';

test('work authored here may be created at the provider', () => {
    assert.equal(refuseProviderCreate({ source: 'seo_pm' }), null);
    assert.equal(refuseProviderCreate({}), null);
});

test('imported work with no entry id is refused', () => {
    // The 14 CSV-imported entries in production look exactly like this: they
    // exist in Basecamp, but we never learned which entry they are.
    assert.equal(
        refuseProviderCreate({ source: 'basecamp', importFingerprint: 'abc' }),
        'imported-entry-not-identified',
    );
});

test('a fingerprint alone is enough to recognize imported work', () => {
    // Source could be widened or renamed later; the fingerprint is written by
    // every import path there is.
    assert.equal(refuseProviderCreate({ importFingerprint: 'abc' }), 'imported-entry-not-identified');
});

test('imported work WITH an entry id is allowed through', () => {
    // It will take the update branch and never reach a create, so refusing it
    // would block legitimate edits to hours already synced.
    assert.equal(
        refuseProviderCreate({ source: 'basecamp', importFingerprint: 'abc', basecampEntryId: 991 }),
        null,
    );
});

test('origin is about where the work came from, not whether it synced', () => {
    assert.equal(isProviderOriginated({ source: 'basecamp' }), true);
    assert.equal(isProviderOriginated({ source: 'seo_pm' }), false);
    assert.equal(isProviderOriginated({}), false);
});

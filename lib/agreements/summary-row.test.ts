import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGREEMENT_SUMMARY_ROW_CLASS, agreementSummaryPhase } from './summary-row.ts';

test('the agreement row keeps one height while history is still loading', () => {
    assert.match(AGREEMENT_SUMMARY_ROW_CLASS, /h-\[4\.125rem\]/);
    assert.equal(AGREEMENT_SUMMARY_ROW_CLASS.includes('min-h-16'), false);
    assert.equal(AGREEMENT_SUMMARY_ROW_CLASS.includes('overflow-hidden'), true);
    assert.equal(agreementSummaryPhase(true, false, null), 'loading');
    assert.equal(agreementSummaryPhase(false, false, null), 'hidden');
    assert.equal(agreementSummaryPhase(false, false, 'Agreement history unavailable.'), 'ready');
    assert.equal(agreementSummaryPhase(false, true, null), 'ready');
    const summary = readFileSync(new URL('../../components/workspace/agreements/ClientAgreementSummary.tsx', import.meta.url), 'utf8');
    const page = readFileSync(new URL('../../app/(dashboard)/workspace/[id]/page.tsx', import.meta.url), 'utf8');
    assert.equal(summary.includes('agreementSummaryPhase'), true);
    assert.equal(summary.includes('AGREEMENT_SUMMARY_ROW_CLASS'), true);
    assert.equal(summary.includes('min-h-16'), false);
    assert.equal(/loading && !history\.length/.test(summary), false);
    assert.equal(page.includes('AGREEMENT_SUMMARY_ROW_CLASS'), true);
    assert.equal(page.includes('min-h-16'), false);
});

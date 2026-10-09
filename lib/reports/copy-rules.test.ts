import test from 'node:test';
import assert from 'node:assert/strict';
import { assertClientCopy, findClientCopyViolations } from './copy-rules';
import { METRIC_DEFS, REPORT_SECTIONS } from './sections';
import { STOCK_TEMPLATES } from './reportTemplates';

test('65 people clicked is rejected next to a Search Console metric', () => {
    assert.throws(() => assertClientCopy('65 people clicked', ['gsc']), /people/);
    const violations = findClientCopyViolations('65 people clicked', ['organic_clicks']);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule, 'gsc_banned_word');
});

test('banned words in a sentence that does not cite Search Console are allowed', () => {
    assert.doesNotThrow(() => assertClientCopy('The team met 4 people. Clicks were 65.', ['gsc']));
    assert.doesNotThrow(() => assertClientCopy('65 people clicked', ['ga4']));
});

test('visits, visitors, customers, and leads are rejected in a Search Console sentence', () => {
    for (const sentence of ['120 visits and 40 clicks', '40 visitors clicked', 'customers saw 10 impressions', 'leads from 80 clicks']) {
        assert.throws(() => assertClientCopy(sentence, ['gsc']), /rejected/);
    }
});

test('calls are rejected for Business Profile call clicks, and call-button taps are not', () => {
    assert.throws(() => assertClientCopy('12 calls', ['CALL_CLICKS']), /calls/);
    assert.doesNotThrow(() => assertClientCopy('Call-button taps were 12.', ['CALL_CLICKS', 'gbp']));
    assert.doesNotThrow(() => assertClientCopy('12 calls', ['gsc']));
});

test('stock templates and metric labels pass the client copy lint', () => {
    for (const section of REPORT_SECTIONS) {
        const sources = section.key === 'gbp' ? ['gbp', 'CALL_CLICKS'] : section.key === 'gsc' ? ['gsc', 'organic_clicks'] : [section.key];
        assert.doesNotThrow(() => assertClientCopy(`${section.name}. ${section.blurb}`, sources));
    }
    for (const [source, defs] of Object.entries(METRIC_DEFS)) {
        for (const def of defs) {
            const sources = source === 'gbp' && def.key === 'calls' ? ['gbp', 'CALL_CLICKS'] : source === 'gsc' ? ['gsc', def.key] : [source];
            assert.doesNotThrow(() => assertClientCopy(def.label, sources));
        }
    }
    for (const template of STOCK_TEMPLATES) {
        assert.equal(template.build().some(block => block.type === 'keyword_rankings_table' || block.type === 'grid_comparison'), false);
        assert.doesNotThrow(() => assertClientCopy([template.name, template.description, ...template.outline].join('\n'), ['gsc', 'organic_clicks', 'CALL_CLICKS']));
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { taskDescriptionText, taskDescriptionChanged } from './description';

test('imported paragraphs and entities become readable without rewriting untouched records', () => {
    const original = '<p dir="auto">Draft an SEO roadmap &amp; send it.</p><p>Due tomorrow.</p>';
    const displayed = 'Draft an SEO roadmap & send it.\n\nDue tomorrow.';
    assert.equal(taskDescriptionText(original), displayed);
    assert.equal(taskDescriptionChanged(original, displayed), false);
    assert.equal(taskDescriptionChanged(original, 'Updated roadmap'), true);
});
test('plain descriptions preserve formatting and angle brackets', () => {
    assert.equal(taskDescriptionText('Keep  two spaces\nBudget <3 hours'), 'Keep  two spaces\nBudget <3 hours');
    assert.equal(taskDescriptionText(null), '');
});
test('imported links retain destinations and executable content is excluded', () => {
    assert.equal(taskDescriptionText('<p>Read <a href="https://example.com/brief">brief</a></p><script>alert(1)</script><iframe>hidden</iframe>'), 'Read brief (https://example.com/brief)');
    assert.equal(taskDescriptionText('<a href="javascript:alert(1)">brief</a>'), 'brief');
});

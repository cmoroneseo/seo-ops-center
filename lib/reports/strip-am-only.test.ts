import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlText, stripAmOnly } from './strip-am-only';

test('an AM-only block is removed from portal HTML, including one nested inside a section', () => {
    const html = `<section><p>Visible.</p><div class="card amonly-block"><p>No September work is recorded.</p><span class="amonly-block">AM writes this.</span></div><p>Still visible.</p></section>`;
    const stripped = stripAmOnly(html);
    assert.equal(stripped.includes('No September work'), false);
    assert.equal(stripped.includes('AM writes this'), false);
    assert.equal(stripped.includes('Visible.'), true);
    assert.equal(stripped.includes('Still visible.'), true);
    assert.equal(htmlText(stripped).includes('September'), false);
});

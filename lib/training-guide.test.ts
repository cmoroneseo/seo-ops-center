import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { buildEmbeddedTrainingGuide, parseTrainingGuideDocument } from './training-guide';
import { isTrainingGuideMessage, parseTrainingGuideState } from './training-guide-state';

const uploadedGuidePath = join(process.cwd(), 'content/training/seo-playbook-2026-full.html');

test('the complete uploaded guide exposes every source section and checklist item', async () => {
    const html = await readFile(uploadedGuidePath, 'utf8');
    const guide = parseTrainingGuideDocument(html);

    assert.equal(guide.title, 'The SEO Playbook — Universal & Local Fundamentals, Evidence-Graded (2026)');
    assert.equal(guide.sections.length, 26);
    // The document header says 132, but the supplied HTML contains 142 real `.item` controls.
    // Preserve and expose the actual controls rather than silently dropping the extra ten.
    assert.equal(guide.totalChecklistItems, 142);
    assert.deepEqual(guide.sections.slice(0, 3).map((section) => section.id), ['how', 'operating', 'model']);
    assert.deepEqual(guide.sections.slice(-4).map((section) => section.id), ['measure', 'myths', 'plan', 'sources']);
    assert.ok(html.includes('if you can generate the page by find-and-replace, so can a classifier'));
    assert.ok(html.includes('Where this playbook and a current Google page disagree, the Google page wins.'));
    assert.equal(createHash('sha256').update(html).digest('hex'), 'bfcb928e9a58d85cfc6cb6a4f4749b7efac92535a90ed6f8358c4ca5e189efad');
});

test('the embedded reader keeps all guide content while adding only reader presentation and progress messaging', async () => {
    const html = await readFile(uploadedGuidePath, 'utf8');
    const embedded = buildEmbeddedTrainingGuide(html);
    const guide = parseTrainingGuideDocument(embedded);

    assert.equal(guide.sections.length, 26);
    assert.equal(guide.totalChecklistItems, 142);
    assert.ok(embedded.includes('data-seo-ops-embed'));
    assert.ok(embedded.includes('seo-playbook-progress'));
    assert.ok(embedded.includes("event.source!==parent"));
    assert.ok(embedded.includes("getElementById('reset')"));
    assert.ok(embedded.includes('var restoring=false'));
    assert.ok(embedded.includes(".chip[data-tr="));
    assert.ok(embedded.includes('Primary sources cited throughout'));
    const withoutEmbedScaffolding = embedded
        .replace(/<style data-seo-ops-embed>[\s\S]*?<\/style>\n?/, '')
        .replace(/<script data-seo-ops-embed>[\s\S]*?<\/script>\n?/, '');
    assert.equal(withoutEmbedScaffolding, html);
});

test('saved guide state restores checks and a valid last-read section safely', () => {
    const sections = ['how', 'lp4b', 'sources'];
    assert.deepEqual(
        parseTrainingGuideState('{"checked":[true,false,true],"selectedId":"sources"}', sections, 3),
        { checked: [true, false, true], selectedId: 'sources' },
    );
    assert.deepEqual(
        parseTrainingGuideState('[true,false,true]', sections, 3),
        { checked: [true, false, true], selectedId: 'lp4b' },
    );
    assert.deepEqual(
        parseTrainingGuideState('{"checked":[true,"yes"],"selectedId":"missing"}', sections, 3),
        { checked: [true, false], selectedId: 'lp4b' },
    );
});

test('guide messages reject malformed or out-of-inventory payloads', () => {
    const sections = ['how', 'lp4b'];
    assert.equal(isTrainingGuideMessage({ type: 'seo-playbook-ready' }, sections, 142), true);
    assert.equal(isTrainingGuideMessage({ type: 'seo-playbook-section', id: 'lp4b' }, sections, 142), true);
    assert.equal(isTrainingGuideMessage({ type: 'seo-playbook-section', id: 'missing' }, sections, 142), false);
    assert.equal(isTrainingGuideMessage({ type: 'seo-playbook-progress', completed: 1, total: 142, checked: [true], sections: [] }, sections, 142), true);
    assert.equal(isTrainingGuideMessage({ type: 'seo-playbook-progress', completed: 200, total: 142, checked: [], sections: [] }, sections, 142), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_REFERENCE_LINKS,
    parseReferenceLinks,
    validateReferenceLinks,
} from './reference-links.ts';

const roadmap = {
    label: 'All In One Construction - 6-Month SEO Roadmap',
    url: 'https://docs.google.com/document/d/roadmap',
};

test('a well-formed jsonb array round-trips', () => {
    assert.deepEqual(parseReferenceLinks([roadmap]), [roadmap]);
});

test('parsing is defensive — a jsonb column can hold anything', () => {
    for (const stored of [null, undefined, {}, 'links', 7, true]) {
        assert.deepEqual(parseReferenceLinks(stored), []);
    }
});

test('parsing drops unusable entries instead of throwing', () => {
    const stored = [
        roadmap,
        null,
        'https://example.com',
        { label: 'no url' },
        { url: 'https://example.com/no-label' },
        { label: '   ', url: 'https://example.com' },
        { label: 'numeric url', url: 42 },
        { label: 'nested', url: { href: 'https://example.com' } },
    ];
    assert.deepEqual(parseReferenceLinks(stored), [roadmap]);
});

test('a stored javascript: href can never reach the UI', () => {
    const stored = [
        { label: 'click', url: 'javascript:alert(document.cookie)' },
        { label: 'sneaky', url: 'java\nscript:alert(1)' },
        { label: 'payload', url: 'data:text/html,<script>alert(1)</script>' },
        roadmap,
    ];
    assert.deepEqual(parseReferenceLinks(stored), [roadmap]);
});

test('parsing trims and caps what it hands back', () => {
    assert.deepEqual(
        parseReferenceLinks([{ label: '  Roadmap  ', url: '  https://example.com/a  ' }]),
        [{ label: 'Roadmap', url: 'https://example.com/a' }],
    );

    const many = Array.from({ length: MAX_REFERENCE_LINKS + 5 }, (_, index) => ({
        label: `Doc ${index}`,
        url: `https://example.com/${index}`,
    }));
    assert.equal(parseReferenceLinks(many).length, MAX_REFERENCE_LINKS);
});

test('validation accepts a good list and normalizes it', () => {
    const result = validateReferenceLinks([
        { label: '  Roadmap  ', url: '  https://docs.google.com/document/d/abc  ' },
    ]);
    assert.deepEqual(result, {
        ok: true,
        links: [{ label: 'Roadmap', url: 'https://docs.google.com/document/d/abc' }],
    });
});

test('an absent list is not an error', () => {
    assert.deepEqual(validateReferenceLinks(undefined), { ok: true, links: [] });
    assert.deepEqual(validateReferenceLinks(null), { ok: true, links: [] });
    assert.deepEqual(validateReferenceLinks([]), { ok: true, links: [] });
});

test('validation refuses rather than drops', () => {
    const rejected = [
        'https://example.com',
        [{ label: 'no url' }],
        [{ label: '', url: 'https://example.com' }],
        [{ label: '   ', url: 'https://example.com' }],
        [{ label: 'x', url: 'javascript:alert(1)' }],
        [{ label: 'x', url: 'JaVaScRiPt:alert(1)' }],
        [{ label: 'x', url: 'data:text/html,<script>alert(1)</script>' }],
        [{ label: 'x', url: '//evil.com' }],
        [{ label: 'x', url: 'not a url' }],
        [{ label: 'x', url: 42 }],
        [null],
    ];
    for (const input of rejected) {
        const result = validateReferenceLinks(input);
        assert.equal(result.ok, false, `expected rejection: ${JSON.stringify(input)}`);
        assert.ok(!result.ok && result.error.length > 0);
    }
});

test('one row cannot carry unbounded data', () => {
    const many = Array.from({ length: MAX_REFERENCE_LINKS + 1 }, (_, index) => ({
        label: `Doc ${index}`,
        url: `https://example.com/${index}`,
    }));
    const result = validateReferenceLinks(many);
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error : '', /at most 10 links/);

    assert.equal(validateReferenceLinks(many.slice(0, MAX_REFERENCE_LINKS)).ok, true);
});

test('an over-long label is refused', () => {
    const result = validateReferenceLinks([
        { label: 'x'.repeat(201), url: 'https://example.com' },
    ]);
    assert.equal(result.ok, false);
});

test('internal paths are a legitimate reference', () => {
    assert.deepEqual(validateReferenceLinks([{ label: 'Client', url: '/clients/abc' }]), {
        ok: true,
        links: [{ label: 'Client', url: '/clients/abc' }],
    });
});

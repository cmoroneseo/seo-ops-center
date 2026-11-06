import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeUrl, type NormalizedUrl } from './normalize-url';

/**
 * MEG-shaped fixtures stand in for position-tracking spec §4.2–4.3.
 * That spec is not in this repo. The table covers Wix `#viewer-*` fragments,
 * `utm_*` parameters, and Google Business Profile / Maps URLs on
 * marketingempiregroup.com.
 */
const MEG = 'https://www.marketingempiregroup.com';

const cases: Array<{ name: string; input: string | null | undefined; expected: NormalizedUrl | null }> = [
    {
        name: 'strips a Wix #viewer fragment',
        input: `${MEG}/seo-services#viewer-k3f9a`,
        expected: { url: `${MEG}/seo-services`, surface: 'organic' },
    },
    {
        name: 'collapses a second #viewer id on the same page',
        input: `${MEG}/seo-services#viewer-zz91`,
        expected: { url: `${MEG}/seo-services`, surface: 'organic' },
    },
    {
        name: 'strips a non-viewer fragment',
        input: `${MEG}/seo-services#contact`,
        expected: { url: `${MEG}/seo-services`, surface: 'organic' },
    },
    {
        name: 'strips utm_* and keeps the fragment off the result',
        input: `${MEG}/seo-services?utm_source=google&utm_medium=cpc&utm_campaign=brand#viewer-k3f9a`,
        expected: { url: `${MEG}/seo-services`, surface: 'organic' },
    },
    {
        name: 'strips mixed-case utm_* names',
        input: `${MEG}/SEO-Services/?UTM_Source=Google&utm_medium=cpc#viewer-ZZ`,
        expected: { url: `${MEG}/SEO-Services/`, surface: 'organic' },
    },
    {
        name: 'keeps non-utm query params and their order',
        input: `${MEG}/marketing-agency-riverside?service=seo&utm_source=newsletter&city=riverside#viewer-r1`,
        expected: { url: `${MEG}/marketing-agency-riverside?service=seo&city=riverside`, surface: 'organic' },
    },
    {
        name: 'leaves a different marketing-agency city page distinct',
        input: `${MEG}/marketing-agency-corona?service=seo#viewer-c2`,
        expected: { url: `${MEG}/marketing-agency-corona?service=seo`, surface: 'organic' },
    },
    {
        name: 'does not strip a param that only contains the letters utm',
        input: `${MEG}/blog?page=2&utm=keep&utm_content=hero`,
        expected: { url: `${MEG}/blog?page=2&utm=keep`, surface: 'organic' },
    },
    {
        name: 'classifies utm_medium=gbp as gbp_link and strips the params',
        input: `${MEG}/contact?utm_source=gmb&utm_medium=gbp&utm_campaign=profile#viewer-aa1`,
        expected: { url: `${MEG}/contact`, surface: 'gbp_link' },
    },
    {
        name: 'classifies an uppercase utm_medium=GBP value',
        input: `${MEG}/contact?UTM_MEDIUM=GBP`,
        expected: { url: `${MEG}/contact`, surface: 'gbp_link' },
    },
    {
        name: 'classifies percent-encoded utm_medium%3dgbp',
        input: `${MEG}/contact?utm_medium%3dgbp#viewer-enc`,
        expected: { url: `${MEG}/contact`, surface: 'gbp_link' },
    },
    {
        name: 'classifies a Google Maps place URL and strips its fragment and utm',
        input: 'https://www.google.com/maps/place/Marketing+Empire+Group/@33.9806,-117.3759,17z?utm_source=share#viewer-map1',
        expected: {
            url: 'https://www.google.com/maps/place/Marketing+Empire+Group/@33.9806,-117.3759,17z',
            surface: 'gbp_link',
        },
    },
    {
        name: 'classifies a maps.google.com cid URL',
        input: 'https://maps.google.com/?cid=18446744073709551615&utm_medium=gbp',
        expected: { url: 'https://maps.google.com/?cid=18446744073709551615', surface: 'gbp_link' },
    },
    {
        name: 'classifies a g.page short link',
        input: 'https://g.page/marketingempiregroup?utm_source=google',
        expected: { url: 'https://g.page/marketingempiregroup', surface: 'gbp_link' },
    },
    {
        name: 'classifies a maps.app.goo.gl short link',
        input: 'https://maps.app.goo.gl/AbCdEfGh#viewer-9',
        expected: { url: 'https://maps.app.goo.gl/AbCdEfGh', surface: 'gbp_link' },
    },
    {
        name: 'classifies a business.google.com locations URL',
        input: 'https://business.google.com/locations?utm_medium=gbp',
        expected: { url: 'https://business.google.com/locations', surface: 'gbp_link' },
    },
    {
        name: 'leaves a Google search URL organic',
        input: 'https://www.google.com/search?q=marketing+agency+riverside',
        expected: { url: 'https://www.google.com/search?q=marketing+agency+riverside', surface: 'organic' },
    },
    {
        name: 'rejects an empty string',
        input: '   ',
        expected: null,
    },
    {
        name: 'rejects a missing value',
        input: null,
        expected: null,
    },
    {
        name: 'rejects a non-http URL',
        input: 'javascript:alert(1)',
        expected: null,
    },
    {
        name: 'rejects a schemeless host',
        input: 'marketingempiregroup.com/seo-services#viewer-1',
        expected: null,
    },
];

for (const row of cases) {
    test(`normalizeUrl: ${row.name}`, () => {
        assert.deepEqual(normalizeUrl(row.input), row.expected);
        if (row.expected) {
            assert.equal(row.expected.url.includes('#'), false);
            assert.equal(/[?&]utm_/i.test(row.expected.url), false);
        }
    });
}

test('normalizeUrl: two Wix viewer fragments are one page', () => {
    const first = normalizeUrl(`${MEG}/seo-services#viewer-k3f9a`);
    const second = normalizeUrl(`${MEG}/seo-services?utm_source=wix#viewer-zz91`);
    assert.deepEqual(first, second);
    assert.equal(first?.url, `${MEG}/seo-services`);
});

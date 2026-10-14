import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseBingDate } from './date.ts';
import { hostKey } from './host.ts';
import { mapPageWeeks, mapQueryWeeks, mapTraffic, mapUserSites, unwrapBingList } from './map.ts';
import { bingApiUrl, redactBingSecret } from './url.ts';

const KEY = 'synthetic-bing-key';

test('host keys drop scheme, path, port, trailing dot, and a leading www', () => {
    assert.equal(hostKey('www.Example.TEST'), 'example.test');
    assert.equal(hostKey('https://www.example.test/'), 'example.test');
    assert.equal(hostKey('https://example.test/blog'), 'example.test');
    assert.equal(hostKey('EXAMPLE.TEST'), 'example.test');
    assert.equal(hostKey('https://WWW.Other.TEST:443/path'), 'other.test');
    assert.equal(hostKey('example.test.'), 'example.test');
    assert.equal(hostKey('http://example.test'), 'example.test');
    assert.equal(hostKey('//example.test/a'), 'example.test');
    assert.equal(hostKey(''), null);
    assert.equal(hostKey('not a host'), null);
    assert.equal(hostKey('localhost'), null);
    assert.equal(hostKey('[::1]'), null);
    assert.equal(hostKey(null), null);
});

test('Bing dates use the offset calendar day', () => {
    assert.equal(parseBingDate('/Date(1316156400000-0700)/'), '2011-09-16');
    assert.equal(parseBingDate('/Date(1609459200000-0800)/'), '2020-12-31');
    assert.equal(parseBingDate('/Date(1609459200000+0000)/'), '2021-01-01');
    assert.equal(parseBingDate('/Date(1609459200000)/'), '2021-01-01');
    assert.equal(parseBingDate('/Date(1609459200000+1500)/'), null);
    assert.equal(parseBingDate('/Date(1609459200000+0060)/'), null);
    assert.equal(parseBingDate('2020-12-31'), null);
    assert.equal(parseBingDate(null), null);
});

test('user sites keep the exact URL and drop verification codes', () => {
    const mapped = mapUserSites({
        d: [{
            Url: ' https://Example.TEST/blog ',
            IsVerified: true,
            AuthenticationCode: 'drop-this-token',
            DnsVerificationCode: 'drop-this-too',
        }, {
            Url: 'https://other.test/',
            IsVerified: false,
        }, {
            IsVerified: true,
        }],
    });
    assert.deepEqual(mapped, [
        { siteUrl: 'https://Example.TEST/blog', verified: true },
        { siteUrl: 'https://other.test/', verified: false },
    ]);
    assert.equal(Object.hasOwn(mapped[0], 'rank'), false);
});

test('a non-list payload is not an empty account', () => {
    assert.throws(() => unwrapBingList({ d: { Message: 'no' } }), { message: 'Bing Webmaster response was not a list' });
    assert.throws(() => mapUserSites({ error: true }), { message: 'Bing Webmaster response was not a list' });
    assert.deepEqual(mapUserSites({ d: [] }), []);
    assert.deepEqual(mapTraffic({ error: true }), { ok: false });
});

test('traffic and weeks fail closed, and one query week stays one row', () => {
    const day = '/Date(1316156400000-0700)/';
    const good = mapTraffic({ d: [{ Date: day, Clicks: 3, Impressions: 9 }] });
    assert.deepEqual(good, { ok: true, rows: [{ data_date: '2011-09-16', clicks: 3, impressions: 9 }] });
    assert.deepEqual(mapTraffic({ d: [{ Date: day, Clicks: 3, Impressions: 9 }, { Date: day, Clicks: 1, Impressions: 1 }] }), { ok: false });
    assert.deepEqual(mapTraffic({ d: [{ Date: day, Clicks: 1.5, Impressions: 1 }] }), { ok: false });
    assert.deepEqual(mapTraffic({ d: [{ Date: day, Clicks: -1, Impressions: 1 }] }), { ok: false });

    const week = mapQueryWeeks({
        d: [{
            Query: ' widgets ',
            Clicks: 2,
            Impressions: 10,
            AvgImpressionPosition: 4.5,
            Date: '/Date(1609459200000-0800)/',
        }],
    });
    assert.equal(week.ok, true);
    if (!week.ok) return;
    assert.equal(week.rows.length, 1);
    assert.deepEqual(week.rows[0], {
        week_ending: '2020-12-31',
        query: 'widgets',
        clicks: 2,
        impressions: 10,
        avg_impression_position: 4.5,
        avg_click_position: null,
    });
    assert.equal(Object.hasOwn(week.rows[0], 'rank'), false);
    assert.deepEqual(mapQueryWeeks({ d: [{ Query: '   ', Clicks: 1, Impressions: 1, Date: day }] }), { ok: false });
    assert.deepEqual(mapQueryWeeks({ d: [{ Query: 'widgets', Clicks: 1, Impressions: 1, AvgImpressionPosition: Number.POSITIVE_INFINITY, Date: day }] }), { ok: false });

    const page = mapPageWeeks([{ Query: 'https://example.test/a', Clicks: 0, Impressions: 4, AvgClickPosition: 0, Date: day }]);
    assert.deepEqual(page, {
        ok: true,
        rows: [{
            week_ending: '2011-09-16',
            page: 'https://example.test/a',
            clicks: 0,
            impressions: 4,
            avg_impression_position: null,
            avg_click_position: 0,
        }],
    });
    const again = mapQueryWeeks({
        d: [{ Query: 'widgets', Clicks: 2, Impressions: 10, AvgImpressionPosition: 4.5, Date: '/Date(1609459200000-0800)/' }],
    });
    assert.deepEqual(again, week);
});

test('the API URL allowlist redacts the key and rejects deferred methods', () => {
    const stats = new URL(bingApiUrl('GetQueryStats', KEY, 'https://example.test/blog'));
    assert.equal(`${stats.origin}${stats.pathname}`, 'https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats');
    assert.equal(stats.searchParams.get('apikey'), KEY);
    assert.equal(stats.searchParams.get('siteUrl'), 'https://example.test/blog');
    const sites = new URL(bingApiUrl('GetUserSites', KEY));
    assert.equal(sites.searchParams.get('siteUrl'), null);
    for (const method of ['GetCrawlStats', 'SubmitUrl', 'IndexNow', 'getquerystats']) {
        assert.throws(() => bingApiUrl(method, KEY), { message: 'Bing Webmaster method is not allowed' });
    }
    assert.throws(() => bingApiUrl('GetUserSites', '  '), { message: 'Bing Webmaster API key is missing' });
    const leaked = `https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=${KEY}&siteUrl=https%3A%2F%2Fexample.test%2F ${KEY}`;
    assert.equal(
        redactBingSecret(leaked, KEY),
        'https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=REDACTED&siteUrl=https%3A%2F%2Fexample.test%2F REDACTED',
    );
});

test('Bing sync source does not log and the example env leaves the key empty', () => {
    const files = readdirSync(new URL('.', import.meta.url))
        .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'log.ts');
    for (const name of files) {
        const source = readFileSync(new URL(name, import.meta.url), 'utf8');
        assert.equal(source.split('console.').length, 1, name);
    }
    const log = readFileSync(new URL('./log.ts', import.meta.url), 'utf8');
    assert.equal(log.split('console.log').length, 2);
    assert.equal(log.split('BING_WEBMASTER_API_KEY').length, 1);
    const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
    assert.match(example, /^BING_WEBMASTER_API_KEY=$/m);
    assert.doesNotMatch(example, /NEXT_PUBLIC_BING/);
});

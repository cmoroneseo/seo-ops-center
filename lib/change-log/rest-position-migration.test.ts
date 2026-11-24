import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { gscPageCandidates } from './match';
import { normalizeResultUrl } from '../search-reporting/result-url';

const migration = readFileSync(new URL('../../migrations/140_seo_change_rest_position.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

test('migration 140 is mirrored and restricts the bounded RPC to service-role callers', () => {
    assert.match(migration, /NOT APPLIED — needs owner approval/);
    assert.ok(schema.includes(migration));
    assert.match(migration, /create or replace function public\.seo_change_rest_position\(/i);
    assert.match(migration, /language sql\s+stable\s+security invoker\s+set search_path = pg_catalog/i);
    assert.match(migration, /cardinality\(p_day_ids\) between 1 and 84/);
    assert.match(migration, /revoke all on function public\.seo_change_rest_position\(uuid, uuid, text, uuid\[\], text\[\]\) from public, anon, authenticated;/i);
    assert.match(migration, /grant execute on function public\.seo_change_rest_position\(uuid, uuid, text, uuid\[\], text\[\]\) to service_role;/i);
    assert.doesNotMatch(migration, /\bconcurrently\b/i);
});

test('migration 140 aggregates only scoped final organic page facts outside the test and GBP variants', async () => {
    const db = new PGlite();
    const organization = '00000000-0000-0000-0000-000000000001';
    const client = '00000000-0000-0000-0000-000000000002';
    const other = '00000000-0000-0000-0000-000000000003';
    const dayIds = Array.from({ length: 8 }, (_, i) => `00000000-0000-0000-0000-00000000001${i}`);
    const property = 'sc-domain:example.com';
    const rpc = 'select * from public.seo_change_rest_position($1, $2, $3, $4, $5)';
    const testUrls = ['https://example.com/', 'https://example.com/About', 'https://example.com/caf%C3%A9'];
    const keys = testUrls.map(normalizeResultUrl);
    try {
        await db.exec(`
            create role anon;
            create role authenticated;
            create role service_role;
            create table public.gsc_history_days (
                id uuid primary key, organization_id uuid, client_id uuid, property text,
                data_date date, search_type text default 'web', is_incomplete boolean default false
            );
            create table public.gsc_history_facts (
                day_id uuid, grain text, page text, clicks bigint, impressions bigint,
                position double precision, surface text
            );
            grant select on public.gsc_history_days, public.gsc_history_facts to service_role;
        `);
        await db.exec(migration);
        await db.exec(migration);
        for (const [i, dayId] of dayIds.entries()) {
            await db.query('insert into gsc_history_days values ($1, $2, $3, $4, $5, $6, $7)', [
                dayId, i === 2 ? other : organization, i === 3 ? other : client, i === 4 ? 'sc-domain:other.com' : property,
                `2026-11-1${i}`, i === 5 ? 'image' : 'web', i === 6,
            ]);
        }
        const addFact = (dayId: string, page: string, impressions: number, position: number, surface: string | null = 'organic', grain = 'page') =>
            db.query('insert into gsc_history_facts values ($1, $2, $3, 1, $4, $5, $6)', [dayId, grain, page, impressions, position, surface]);
        for (const page of [
            ...new Set(testUrls.flatMap(gscPageCandidates)),
            'https://www.example.com/ABOUT/?ref=test',
            'https://www.example.com/%61bout/?ref=test',
            'https://www.example.com/Caf%c3%a9/?ref=test',
            'https://example.com/other?UTM_CAMPAIGN=GBP_LISTING#section',
            'https://example.com/other?utm_medium=%67bp',
            'https://example.com/other?utm_medium=organic&%75tm_source=google',
            'https://example.com/other?utm_medium=gbp&utm_medium=email',
        ]) {
            await addFact(dayIds[0], page, 100, 1);
        }
        await addFact(dayIds[0], 'https://example.com/other', 100, 20, null);
        await addFact(dayIds[0], 'https://example.com/other?utm_medium=email&utm_medium=gbp', 300, 40, '');
        await addFact(dayIds[0], 'https://example.com/other?utm_medium=gbp=extra#utm_medium=gbp', 10, 10);
        await addFact(dayIds[0], 'https://example.com/hidden', 100, 1, 'gbp_link');
        await addFact(dayIds[0], 'https://example.com/hidden', 100, 1, 'organic', 'query_page');
        await addFact(dayIds[0], 'https://example.com/hidden', 100, 1, 'organic', 'page_organic');
        await addFact(dayIds[1], 'https://example.com/unrequested', 100, 1);
        for (const dayId of dayIds.slice(2, 7)) await addFact(dayId, 'https://example.com/out-of-scope', 100, 1);
        await addFact(dayIds[7], 'https://example.com/other', 20, 10);

        await db.exec('set role authenticated');
        await assert.rejects(db.query(rpc, [organization, client, property, dayIds, keys]), /permission denied/);
        await db.exec('set role service_role');
        const selected = [dayIds[0], ...dayIds.slice(2)];
        assert.deepEqual((await db.query(rpc, [organization, client, property, selected, keys])).rows, [
            { data_date: new Date('2026-11-10'), clicks: 3, impressions: 410, position_weight: 14100 },
            { data_date: new Date('2026-11-17'), clicks: 1, impressions: 20, position_weight: 200 },
        ]);
        assert.deepEqual((await db.query(rpc, [organization, client, property, Array(85).fill(dayIds[0]), keys])).rows, []);
    } finally {
        await db.close();
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/097_ga4_metrics_null_empty_months.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const fake = { sessions: 0, new_users: 0, organic_sessions: 0, bounce_rate: null };
const keptOrganic = { sessions: 40, new_users: 12, organic_sessions: 0, bounce_rate: null };

type Queryable = {
    exec: (sql: string) => Promise<unknown>;
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
    close: () => Promise<unknown>;
};

test('097 documents the exact preview and is mirrored into schema.sql', () => {
    assert.match(migration, /source = 'ga4'/);
    assert.match(migration, /source_type = 'auto'/);
    assert.match(migration, /provenance is null/);
    assert.match(migration, /America\/Los_Angeles/);
    assert.match(migration, /rows_to_null/);
    assert.match(migration, /organic_zeros_kept/);
    assert.equal(migration.includes('Not applied in this change.'), true);
    assert.equal(/create table/i.test(migration), false);
    assert.equal(schema.includes('rows_to_null'), true);
    assert.equal(schema.includes("source = 'ga4'"), true);
});

test('only a closed auto GA4 month with the exact empty payload becomes null', async () => {
    const db = new PGlite() as unknown as Queryable;
    try {
        await db.exec(`
            create table public.metrics (
                id text primary key,
                source text,
                source_type text,
                provenance jsonb,
                metric_month text,
                data jsonb,
                updated_at timestamptz
            );
        `);
        const current = (await db.query<{ month: string }>(
            `select to_char((now() at time zone 'America/Los_Angeles'), 'YYYY-MM') as month`,
        )).rows[0].month;
        const rows = [
            ['past-empty', 'ga4', 'auto', null, '2020-01', fake],
            ['open-empty', 'ga4', 'auto', null, current, fake],
            ['organic-zero', 'ga4', 'auto', null, '2020-02', keptOrganic],
            ['manual', 'ga4', 'manual', null, '2020-03', fake],
            ['provenance', 'ga4', 'auto', { sync: true }, '2020-04', fake],
            ['extra', 'ga4', 'auto', null, '2020-05', { ...fake, notes: 'kept' }],
            ['gsc', 'gsc', 'auto', null, '2020-01', { clicks: 0, impressions: 0 }],
            ['future', 'ga4', 'auto', null, '2099-12', fake],
        ] as const;
        for (const [id, source, sourceType, provenance, month, data] of rows) {
            await db.query(
                `insert into public.metrics(id, source, source_type, provenance, metric_month, data)
                 values ($1, $2, $3, $4::jsonb, $5, $6::jsonb)`,
                [id, source, sourceType, provenance == null ? null : JSON.stringify(provenance), month, JSON.stringify(data)],
            );
        }
        await db.exec(migration);
        const values = await db.query<{ id: string; sessions: number | null; clicks: number | null }>(`
            select id,
                   (data ->> 'sessions')::float8 as sessions,
                   (data ->> 'clicks')::float8 as clicks
            from public.metrics
            order by id
        `);
        const byId = Object.fromEntries(values.rows.map(row => [row.id, row]));
        assert.equal(byId['past-empty'].sessions, null);
        assert.equal(byId['open-empty'].sessions, 0);
        assert.equal(byId['organic-zero'].sessions, 40);
        assert.equal(byId.manual.sessions, 0);
        assert.equal(byId.provenance.sessions, 0);
        assert.equal(byId.extra.sessions, 0);
        assert.equal(byId.gsc.clicks, 0);
        assert.equal(byId.future.sessions, 0);
        const preview = await db.query<{ rows_to_null: number }>(`
            select count(*)::int as rows_to_null
            from public.metrics
            where source = 'ga4'
              and source_type = 'auto'
              and provenance is null
              and metric_month ~ '^\\d{4}-(0[1-9]|1[0-2])$'
              and metric_month < to_char((now() at time zone 'America/Los_Angeles'), 'YYYY-MM')
              and data = '{"bounce_rate":null,"new_users":0,"organic_sessions":0,"sessions":0}'::jsonb
        `);
        assert.equal(preview.rows[0].rows_to_null, 0);
        await db.exec(migration);
        assert.equal((await db.query<{ sessions: number | null }>(
            `select (data ->> 'sessions')::numeric as sessions from public.metrics where id = 'past-empty'`,
        )).rows[0].sessions, null);
    } finally {
        await db.close();
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/124_topical_map_record_production.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const COLUMNS = [
    'production_status',
    'work_month',
    'due_date',
    'published_on',
    'draft_url',
    'live_url',
] as const;

function executable(sql: string): string {
    return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

test('migration 124 adds nullable columns with no default, backfill, or policy change', () => {
    const sql = executable(migration);
    for (const column of COLUMNS) {
        assert.match(sql, new RegExp(`add column if not exists ${column} `));
    }
    assert.doesNotMatch(sql, /\bupdate\b/i);
    assert.doesNotMatch(sql, /\binsert\b/i);
    assert.doesNotMatch(sql, /\bdefault\s/i);
    assert.doesNotMatch(sql, /\bnot null\b/i);
    assert.doesNotMatch(sql, /\bcreate policy\b/i);
    assert.doesNotMatch(sql, /\benable row level security\b/i);
    assert.doesNotMatch(sql, /\bgrant\b/i);
    assert.doesNotMatch(sql, /\brevoke\b/i);

    const marker = '-- 124_topical_map_record_production.sql';
    const start = schema.indexOf(marker);
    const rest = schema.slice(start + marker.length);
    const next = rest.search(/\n-- (?:Migration )?\d{3}[_:]/);
    const mirror = schema.slice(start, next === -1 ? undefined : start + marker.length + next);
    assert.ok(mirror.length > 0);
    const mirrored = executable(mirror);
    for (const column of COLUMNS) {
        assert.match(mirrored, new RegExp(`add column if not exists ${column} `));
    }
    assert.doesNotMatch(mirrored, /\bupdate\b/i);
    assert.doesNotMatch(mirrored, /\bdefault\s/i);
    assert.doesNotMatch(mirrored, /\bcreate policy\b/i);
});

async function database() {
    const db = new PGlite();
    await db.exec(`
        create table public.topical_map_records (
            id uuid primary key default gen_random_uuid(),
            title text not null,
            status text not null default 'pending'
        );
    `);
    await db.exec(`insert into public.topical_map_records (title, status) values ('Existing page', 'approved')`);
    await db.exec(migration);
    return db;
}

test('existing rows stay null and the checks reject a bad production value', async () => {
    const db = await database();
    const existing = await db.query<Record<(typeof COLUMNS)[number], string | null>>(`
        select production_status, work_month, due_date, published_on, draft_url, live_url
        from public.topical_map_records
    `);
    assert.equal(existing.rows.length, 1);
    for (const column of COLUMNS) assert.equal(existing.rows[0]?.[column], null);
    assert.equal((await db.query<{ status: string }>('select status from public.topical_map_records')).rows[0]?.status, 'approved');

    const columns = await db.query<{ column_name: string; column_default: string | null; is_nullable: string }>(`
        select column_name, column_default, is_nullable
        from information_schema.columns
        where table_name = 'topical_map_records'
          and column_name = any($1)
        order by column_name
    `, [COLUMNS]);
    assert.deepEqual(columns.rows.map(row => row.column_name), [...COLUMNS].sort());
    for (const row of columns.rows) {
        assert.equal(row.column_default, null, row.column_name);
        assert.equal(row.is_nullable, 'YES', row.column_name);
    }

    await db.exec(`
        update public.topical_map_records
        set production_status = 'writing',
            work_month = '2026-11',
            due_date = '2026-11-02',
            published_on = null,
            draft_url = 'https://docs.example/draft',
            live_url = null
    `);
    const saved = await db.query<{ work_month: string; due_date: string | null; published_on: string | null }>(
        'select work_month, due_date::text, published_on::text from public.topical_map_records',
    );
    assert.equal(saved.rows[0]?.work_month, '2026-11');
    assert.equal(saved.rows[0]?.due_date, '2026-11-02');
    assert.equal(saved.rows[0]?.published_on, null);

    await assert.rejects(() => db.exec(`update public.topical_map_records set production_status = 'idea'`));
    await assert.rejects(() => db.exec(`update public.topical_map_records set production_status = 'Published'`));
    await assert.rejects(() => db.exec(`update public.topical_map_records set work_month = '3'`));
    await assert.rejects(() => db.exec(`update public.topical_map_records set work_month = '2026-13'`));
    await assert.rejects(() => db.exec(`update public.topical_map_records set due_date = '2026-13-40'`));
    await assert.rejects(() => db.exec(`update public.topical_map_records set draft_url = 'javascript:alert(1)'`));
    await assert.rejects(() => db.exec(`update public.topical_map_records set live_url = '/services'`));
    await assert.rejects(() => db.exec(`update public.topical_map_records set draft_url = '${'https://example.com/'.padEnd(501, 'a')}'`));
    assert.equal(migration.includes('content_type'), false);
    assert.equal(schema.includes('topical_map_records_content_type_check'), false);
});

test('the migration can be applied twice', async () => {
    const db = await database();
    await db.exec(migration);
    const columns = await db.query<{ column_name: string }>(`
        select column_name from information_schema.columns
        where table_name = 'topical_map_records'
          and column_name = any($1)
        order by column_name
    `, [COLUMNS]);
    assert.deepEqual(columns.rows.map(row => row.column_name), [...COLUMNS].sort());
    const stillNull = await db.query<{ production_status: string | null }>(
        'select production_status from public.topical_map_records',
    );
    assert.equal(stillNull.rows[0]?.production_status, null);
});

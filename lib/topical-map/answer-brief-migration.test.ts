import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/130_topical_map_record_answer_brief.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

function executable(sql: string): string {
    return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

test('migration 130 adds one nullable jsonb column with no default, backfill, or policy change', () => {
    for (const sql of [executable(migration), executable(schema.slice(schema.indexOf('-- 130_topical_map_record_answer_brief.sql')))]) {
        assert.match(sql, /add column if not exists answer_brief jsonb;/);
        assert.doesNotMatch(sql, /\bupdate\b/i);
        assert.doesNotMatch(sql, /\binsert\b/i);
        assert.doesNotMatch(sql, /\bdefault\s/i);
        assert.doesNotMatch(sql, /\bnot null\b/i);
        assert.doesNotMatch(sql, /\bcreate policy\b/i);
        assert.doesNotMatch(sql, /\bgrant\b/i);
    }
    assert.ok(schema.includes('-- 130_topical_map_record_answer_brief.sql'));
});

async function database() {
    const db = new PGlite();
    await db.exec(`
        create table public.topical_map_records (
            id uuid primary key default gen_random_uuid(),
            title text not null
        );
    `);
    await db.exec(`insert into public.topical_map_records (title) values ('Existing page')`);
    await db.exec(migration);
    return db;
}

test('existing rows stay null, a brief object saves, and other shapes are rejected', async () => {
    const db = await database();
    const existing = await db.query<{ answer_brief: unknown }>('select answer_brief from public.topical_map_records');
    assert.equal(existing.rows[0]?.answer_brief, null);

    await db.exec(`update public.topical_map_records set answer_brief = '{"ai_prompts":["Who installs turf?"],"headings":["Our process"],"schema_type":"Service","price_table":false}'`);
    const saved = await db.query<{ schema_type: string }>(`select answer_brief->>'schema_type' as schema_type from public.topical_map_records`);
    assert.equal(saved.rows[0]?.schema_type, 'Service');

    await assert.rejects(() => db.exec(`update public.topical_map_records set answer_brief = '[]'`));
    await assert.rejects(() => db.exec(`update public.topical_map_records set answer_brief = '"text"'`));
    await assert.rejects(() => db.exec(`update public.topical_map_records set answer_brief = jsonb_build_object('headings', repeat('a', 9000))`));
});

test('the migration can be applied twice', async () => {
    const db = await database();
    await db.exec(migration);
    const columns = await db.query<{ data_type: string; is_nullable: string; column_default: string | null }>(`
        select data_type, is_nullable, column_default from information_schema.columns
        where table_name = 'topical_map_records' and column_name = 'answer_brief'
    `);
    assert.deepEqual(columns.rows, [{ data_type: 'jsonb', is_nullable: 'YES', column_default: null }]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/083_topical_map_record_spec.sql', import.meta.url), 'utf8');
const words = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(' ');

test('migration 083 adds nullable columns only', () => {
    for (const column of ['answer_first_60 text', 'unique_angle text', 'scheduled_for date', 'spec_status text', 'source text']) {
        assert.match(migration, new RegExp(`add column if not exists ${column};`));
        assert.doesNotMatch(migration, new RegExp(`${column}\\s+not null`, 'i'));
    }
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
    await db.exec(migration);
    return db;
}

test('existing rows stay null and the checks reject a bad spec', async () => {
    const db = await database();
    await db.exec(`insert into public.topical_map_records (title) values ('Existing page')`);
    const existing = await db.query<{ answer_first_60: string | null; source: string | null; spec_status: string | null }>(
        'select answer_first_60, source, spec_status from public.topical_map_records',
    );
    assert.equal(existing.rows[0]?.answer_first_60, null);
    assert.equal(existing.rows[0]?.source, null);
    assert.equal(existing.rows[0]?.spec_status, null);

    await db.exec(`
        update public.topical_map_records
        set source = 'manual', spec_status = 'ready', scheduled_for = '2026-10-12',
            answer_first_60 = '${words(60).replace(/'/g, "''")}', unique_angle = 'A specific angle'
    `);
    await assert.rejects(() => db.exec(`update public.topical_map_records set source = 'ai'`));
    await assert.rejects(() => db.exec(`update public.topical_map_records set spec_status = 'published'`));
    await assert.rejects(() => db.exec(`update public.topical_map_records set scheduled_for = '2026-13-40'`));
    await assert.rejects(() => db.exec(`update public.topical_map_records set answer_first_60 = '${words(61).replace(/'/g, "''")}'`));
    await assert.rejects(() => db.exec(`update public.topical_map_records set unique_angle = '${'a'.repeat(4001)}'`));
});

test('the migration can be applied twice', async () => {
    const db = await database();
    await db.exec(migration);
    const columns = await db.query<{ column_name: string }>(`
        select column_name from information_schema.columns
        where table_name = 'topical_map_records'
          and column_name in ('answer_first_60', 'unique_angle', 'scheduled_for', 'spec_status', 'source')
        order by column_name
    `);
    assert.deepEqual(columns.rows.map(row => row.column_name), [
        'answer_first_60', 'scheduled_for', 'source', 'spec_status', 'unique_angle',
    ]);
});

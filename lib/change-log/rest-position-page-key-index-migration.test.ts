import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/142_seo_change_rest_position_page_key_index.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
const executableSql = (sql: string) => sql.replace(/--[^\n]*/g, '').trim();
const index = `gsc_history_facts_page_key_day_idx
  on public.gsc_history_facts (day_id) where grain = 'page';`;

test('migration 142 contains exactly one standalone concurrent index build', () => {
    assert.match(migration, /NOT APPLIED — needs owner approval/);
    assert.equal(executableSql(migration), `create index concurrently if not exists ${index}`);
});

test('the schema mirror creates a valid partial day index inside a transaction', async () => {
    const mirrorStart = schema.lastIndexOf('-- Migration 142:');
    assert.ok(mirrorStart >= 0);
    const nextMigration = schema.indexOf('\n-- Migration ', mirrorStart + 1);
    const mirror = schema.slice(mirrorStart, nextMigration === -1 ? undefined : nextMigration);
    assert.equal(executableSql(mirror), `create index if not exists ${index}`);

    // PGlite fails CREATE INDEX CONCURRENTLY with "tuple concurrently updated".
    const db = new PGlite();
    try {
        await db.exec(`
            begin;
            create table public.gsc_history_facts (day_id uuid, grain text);
            ${mirror}
            commit;
        `);
        const result = await db.query(`
            select indisvalid, pg_get_indexdef(indexrelid, 1, true) as indexed_column,
                   pg_get_expr(indpred, indrelid) as predicate
            from pg_index
            where indexrelid = 'public.gsc_history_facts_page_key_day_idx'::regclass
        `);
        assert.deepEqual(result.rows, [{ indisvalid: true, indexed_column: 'day_id', predicate: "(grain = 'page'::text)" }]);
    } finally {
        await db.close();
    }
});

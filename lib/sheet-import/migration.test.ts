import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('migration 134 is rerunnable and enforces per-client import keys', async () => {
    const db = new PGlite();
    try {
        await db.exec(`
            create table public.marketing_plan_items (
                id serial primary key, client_id text not null, title text not null, source text,
                constraint marketing_plan_items_source_check check (source in ('template','onboarding','custom','basecamp'))
            );
            create table public.tasks (id serial primary key, client_id text not null, title text not null);
        `);
        const sql = readFileSync(new URL('../../migrations/134_sheet_import_keys.sql', import.meta.url), 'utf8');
        await db.exec(sql);
        await db.exec(sql);
        await db.exec("insert into public.marketing_plan_items (client_id,title,source) values ('a','valid','sheet')");
        await assert.rejects(db.exec("insert into public.marketing_plan_items (client_id,title,source) values ('a','bad','invalid')"),
            { code: '23514' });

        for (const table of ['marketing_plan_items', 'tasks']) {
            const key = 'sheet:abcdefghijklmnopqrstuvwxyz:Roadmap:7';
            const insert = `insert into public.${table} (client_id,title,import_key) values ($1,'item',$2)`;
            await db.query(insert, ['a', key]);
            await db.query(insert, ['b', key]);
            await db.query(insert, ['a', null]);
            await db.query(insert, ['a', null]);
            await assert.rejects(db.query(insert, ['a', 'bad']), { code: '23514' });
            await assert.rejects(db.query(insert, ['a', key]), {
                code: '23505', message: new RegExp(`"${table}_import_key_unique"`),
            });
            const duplicate = await db.query(insert + ' on conflict (client_id, import_key) do nothing returning id', ['a', key]);
            assert.deepEqual(duplicate.rows, []);
        }
    } finally {
        await db.close();
    }
});

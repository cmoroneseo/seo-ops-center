import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/139_seo_change_control_urls.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

test('migration 139 is mirrored and gives existing changes the default comparison', async () => {
    assert.match(migration, /NOT APPLIED/);
    assert.ok(schema.includes(migration));
    const db = new PGlite();
    try {
        await db.exec("create table public.seo_changes (id int primary key); insert into public.seo_changes values (1);");
        await db.exec(migration);
        await db.exec(migration);
        const existing = await db.query('select control_urls from public.seo_changes where id = 1');
        assert.deepEqual(existing.rows, [{ control_urls: [] }]);
        await db.exec("insert into public.seo_changes values (2, array['https://example.test/a', 'https://example.test/b']);");
        const picked = await db.query('select control_urls from public.seo_changes where id = 2');
        assert.deepEqual(picked.rows, [{ control_urls: ['https://example.test/a', 'https://example.test/b'] }]);
        await assert.rejects(db.exec('update public.seo_changes set control_urls = null where id = 1'), /null value/);
    } finally {
        await db.close();
    }
});

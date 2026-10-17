import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/105_task_published_url.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

test('migration 105 adds a nullable live URL and is mirrored', () => {
    assert.equal(schema.includes(migration.trim()), true);
    assert.match(migration, /add column if not exists published_url text/i);
    assert.doesNotMatch(migration, /create policy|enable row level security|drop policy/i);
    assert.doesNotMatch(migration, /add column[^;]*completed_at/i);
});

test('existing tasks keep their rows and gain an empty live URL', async () => {
    const db = new PGlite();
    await db.exec(`
        create table public.tasks (
            id uuid primary key,
            title text not null,
            status text not null,
            completed_at timestamptz
        );
        insert into public.tasks (id, title, status, completed_at) values
            ('00000000-0000-0000-0000-000000000001', 'Publish Approved SEO Content', 'done', '2026-10-17T01:30:00Z');
    `);
    await db.exec(migration);
    const row = (await db.query<{ title: string; published_url: string | null; completed_at: string }>(
        'select title, published_url, completed_at from public.tasks',
    )).rows[0];
    assert.equal(row.title, 'Publish Approved SEO Content');
    assert.equal(row.published_url, null);
    assert.ok(row.completed_at);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/143_bot_timer_trim.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
const columns = [
    'trimmed_from_seconds', 'trimmed_at', 'trimmed_by', 'trimmed_by_bot_key_id', 'paused_trim_source',
];

test('migration 143 mirrors only the nullable audit columns and comments in schema.sql', () => {
    assert.ok(schema.includes(migration));
    const ddl = migration.replace(/^--.*$/gm, '').trim();
    assert.doesNotMatch(ddl, /\b(?:create|drop|grant|revoke|default|not null|update|delete|insert)\b/i);
    const [alter, ...comments] = ddl.split(';').map(line => line.trim()).filter(Boolean);
    assert.match(alter, /^alter table public\.time_logs\b/);
    assert.deepEqual([...alter.matchAll(/add column if not exists (\w+)/g)].map(match => match[1]), columns);
    assert.equal(comments.length, columns.length);
    for (const [index, comment] of comments.entries()) {
        assert.ok(comment.startsWith(`comment on column public.time_logs.${columns[index]} is '`));
    }
    assert.doesNotMatch(schema, /\b(?:write_bot_timer|protect_bot_timer_trim)\b/);
});

test('migration 143 can run twice and leaves audit null on existing rows', async t => {
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec('create table public.time_logs (id integer primary key); insert into public.time_logs values (1);');
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual((await db.query('select * from public.time_logs')).rows, [
        { id: 1, ...Object.fromEntries(columns.map(column => [column, null])) },
    ]);
    await assert.rejects(() => db.exec('update public.time_logs set trimmed_from_seconds = 0'), /check constraint/);
    await assert.rejects(() => db.exec("update public.time_logs set paused_trim_source = '[]'"), /check constraint/);
});

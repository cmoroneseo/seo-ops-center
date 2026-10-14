import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/092_normalize_meg_manager_labels.sql', import.meta.url), 'utf8');
const abel = 'c8219b94-acfe-400a-881e-ab56b7266644';
const carlos = '360c97ac-54fc-41fb-b660-0566d63c2e1b';
const meg = '51f63cc5-4c52-45ed-bb20-2d5ce6320bf2';
const sandbox = '06e536b9-beac-49bc-8c96-1df021102590';

test('migration 092 reserves 089 and does not delete a user', () => {
    assert.equal(migration.includes('089 stays reserved'), true);
    assert.equal(migration.includes('will not delete a user'), true);
    assert.equal(/delete\s+from\s+(auth\.users|public\.users)/i.test(migration), false);
    assert.equal(/security definer/i.test(migration), false);
});

async function seed(db: PGlite) {
    await db.exec(`
        create schema if not exists auth;
        create table auth.users (
            id uuid primary key,
            email text not null,
            raw_user_meta_data jsonb
        );
        create table public.users (
            id uuid primary key,
            email text not null,
            full_name text
        );
        create table public.organization_members (
            organization_id uuid not null,
            user_id uuid not null
        );
        create table public.clients (
            id uuid primary key,
            organization_id uuid not null,
            name text not null,
            account_manager_id uuid,
            account_manager_name text
        );
        create table public.team_bonus (
            id uuid primary key,
            organization_id uuid not null,
            user_id uuid,
            member_name text
        );
    `);
    await db.exec(`
        insert into auth.users(id, email, raw_user_meta_data) values
            ('${abel}', 'amiranda@marketingempiregroup.com', '{"full_name":"Abel Miranda"}'),
            ('${carlos}', 'cmorones@marketingempiregroup.com', '{"full_name":"Carlos Morones"}');
        insert into public.users(id, email, full_name) values
            ('${abel}', 'amiranda@marketingempiregroup.com', 'Abel Miranda'),
            ('${carlos}', 'cmorones@marketingempiregroup.com', 'Carlos Morones');
        insert into public.organization_members(organization_id, user_id) values
            ('${meg}', '${abel}'),
            ('${meg}', '${carlos}');
        insert into public.clients(id, organization_id, name, account_manager_id, account_manager_name) values
            ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '${meg}', 'Short Abel', null, 'Abel'),
            ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '${meg}', 'Full Abel', '${abel}', 'Abel Miranda'),
            ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '${meg}', 'Short Carlos', '${carlos}', 'Carlos'),
            ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', '${meg}', 'Full Carlos', '${carlos}', 'Carlos Morones'),
            ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', '${sandbox}', 'Sandbox alias', '${carlos}', 'Jordan Ellis');
        insert into public.team_bonus(id, organization_id, user_id, member_name) values
            ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '${meg}', null, 'Abel'),
            ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '${meg}', '${carlos}', 'Carlos');
    `);
}

test('short MEG labels attach to the one profile and a second run changes nothing', async () => {
    const db = new PGlite();
    try {
        await seed(db);
        await db.exec(migration);
        await db.exec(migration);
        const clients = await db.query<{ name: string; account_manager_id: string | null; account_manager_name: string }>(
            'select name, account_manager_id, account_manager_name from public.clients order by name',
        );
        const byName = new Map(clients.rows.map(row => [row.name, row]));
        assert.equal(byName.get('Short Abel')?.account_manager_id, abel);
        assert.equal(byName.get('Short Abel')?.account_manager_name, 'Abel Miranda');
        assert.equal(byName.get('Full Abel')?.account_manager_name, 'Abel Miranda');
        assert.equal(byName.get('Short Carlos')?.account_manager_id, carlos);
        assert.equal(byName.get('Short Carlos')?.account_manager_name, 'Carlos Morones');
        assert.equal(byName.get('Sandbox alias')?.account_manager_name, 'Jordan Ellis');
        const bonus = await db.query<{ member_name: string; user_id: string | null }>('select member_name, user_id from public.team_bonus order by member_name');
        assert.deepEqual(bonus.rows.map(row => [row.member_name, row.user_id]), [
            ['Abel Miranda', abel],
            ['Carlos Morones', carlos],
        ]);
        const people = await db.query<{ id: string }>('select id from public.users order by id');
        assert.deepEqual(people.rows.map(row => row.id), [carlos, abel].sort());
    } finally {
        await db.close();
    }
});

test('a second Abel profile aborts the cleanup and leaves the short label in place', async () => {
    const db = new PGlite();
    try {
        await seed(db);
        const other = '99999999-9999-4999-8999-999999999999';
        await db.exec(`
            insert into auth.users(id, email, raw_user_meta_data) values
                ('${other}', 'abel.other@example.com', '{"full_name":"Abel"}');
            insert into public.users(id, email, full_name) values
                ('${other}', 'abel.other@example.com', 'Abel');
        `);
        await assert.rejects(db.exec(migration), /will not delete a user/);
        await db.exec('rollback');
        const short = await db.query<{ account_manager_id: string | null; account_manager_name: string }>(
            "select account_manager_id, account_manager_name from public.clients where name = 'Short Abel'",
        );
        assert.equal(short.rows[0].account_manager_id, null);
        assert.equal(short.rows[0].account_manager_name, 'Abel');
        const people = await db.query<{ count: number }>('select count(*)::int as count from public.users');
        assert.equal(people.rows[0].count, 3);
    } finally {
        await db.close();
    }
});

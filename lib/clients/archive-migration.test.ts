import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/102_client_archive_permissions.sql', import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-000000000010';
const owner = '00000000-0000-0000-0000-000000000001';
const member = '00000000-0000-0000-0000-000000000002';
const viewer = '00000000-0000-0000-0000-000000000003';
const client = '00000000-0000-0000-0000-000000000020';
const other = '00000000-0000-0000-0000-000000000021';

async function database() {
    const db = new PGlite();
    await db.exec(`
        create role anon;
        create role authenticated;
        create schema auth;
        create function auth.uid() returns uuid language sql stable as $$
            select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
        create function auth.role() returns text language sql stable as $$
            select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '')
        $$;
        create table organization_members(organization_id uuid, user_id uuid, role text);
        create table clients(id uuid primary key, organization_id uuid, name text, status text);
        insert into organization_members values
            ('${org}', '${owner}', 'owner'),
            ('${org}', '${member}', 'member'),
            ('${org}', '${viewer}', 'viewer');
        insert into clients values
            ('${client}', '${org}', 'SynBlades', 'active'),
            ('${other}', '${org}', 'Other', 'active');
    `);
    await db.exec(migration);
    return db;
}

async function actAs(db: PGlite, userId: string | null, role = 'authenticated') {
    await db.exec(`select set_config('request.jwt.claim.sub', '${userId ?? ''}', false), set_config('request.jwt.claim.role', '${role}', false)`);
}

test('viewers cannot archive or delete a client; managers can', async () => {
    const db = await database();
    try {
        await actAs(db, viewer);
        await assert.rejects(db.query(`update clients set status = 'inactive' where id = '${client}'`), /cannot delete clients/);
        await assert.rejects(db.query(`delete from clients where id = '${client}'`), /cannot delete clients/);
        await db.query(`update clients set status = 'paused' where id = '${client}'`);
        assert.equal((await db.query<{ status: string }>(`select status from clients where id = '${client}'`)).rows[0].status, 'paused');

        await actAs(db, member);
        await db.query(`update clients set status = 'inactive' where id = '${client}'`);
        assert.equal((await db.query<{ status: string }>(`select status from clients where id = '${client}'`)).rows[0].status, 'inactive');
        await actAs(db, viewer);
        await db.query(`update clients set name = 'SynBlades archived' where id = '${client}'`);
        await actAs(db, '00000000-0000-0000-0000-000000000099');
        await assert.rejects(db.query(`update clients set status = 'inactive' where id = '${other}'`), /cannot delete clients/);
    } finally {
        await db.close();
    }
});

test('a viewer delete is rejected and a member delete is allowed', async () => {
    const db = await database();
    try {
        await actAs(db, viewer);
        await assert.rejects(db.query(`delete from clients where id = '${other}'`), /cannot delete clients/);
        assert.equal((await db.query<{ n: number }>('select count(*)::int n from clients')).rows[0].n, 2);
        await actAs(db, owner);
        await db.query(`delete from clients where id = '${other}'`);
        assert.equal((await db.query<{ n: number }>(`select count(*)::int n from clients where id = '${other}'`)).rows[0].n, 0);
    } finally {
        await db.close();
    }
});

test('service role and an unsigned SQL session can still maintain clients', async () => {
    const db = await database();
    try {
        await actAs(db, viewer, 'service_role');
        await db.query(`update clients set status = 'inactive' where id = '${client}'`);
        assert.equal((await db.query<{ status: string }>(`select status from clients where id = '${client}'`)).rows[0].status, 'inactive');

        await db.exec(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false)`);
        await db.query(`update clients set status = 'active' where id = '${client}'`);
        await db.query(`update clients set status = 'inactive' where id = '${client}'`);
        assert.equal((await db.query<{ status: string }>(`select status from clients where id = '${client}'`)).rows[0].status, 'inactive');
    } finally {
        await db.close();
    }
});

test('schema snapshot mirrors the archive guard', () => {
    const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    assert.ok(schema.includes(migration.trim()));
    assert.match(schema, /create trigger protect_client_archive/i);
});

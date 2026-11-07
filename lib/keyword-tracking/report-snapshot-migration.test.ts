import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/117_report_tracking_snapshots.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
const envExample = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');

const org = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const client = '33333333-3333-4333-8333-333333333333';
const otherClient = '44444444-4444-4444-8444-444444444444';
const report = '66666666-6666-4666-8666-666666666666';

const payload = JSON.stringify({
    schemaVersion: 1,
    state: 'measured',
    keywords: [{ keyword: 'emergency dentist', clicks: 37 }],
});

async function database() {
    const db = new PGlite();
    await db.exec(`
        create role anon;
        create role authenticated;
        create role service_role bypassrls;
        create function public.get_user_org_ids() returns setof uuid
        language sql stable security definer as $$
          select nullif(current_setting('test.org', true), '')::uuid
        $$;
        create table public.organizations(id uuid primary key);
        create table public.clients(
            id uuid primary key,
            organization_id uuid not null references public.organizations(id) on delete cascade,
            name text not null
        );
        create table public.reports(
            id uuid primary key,
            organization_id uuid not null references public.organizations(id) on delete cascade,
            client_id uuid references public.clients(id) on delete cascade
        );
        insert into public.organizations values ('${org}'), ('${other}');
        insert into public.clients values
            ('${client}', '${org}', 'Org A'),
            ('${otherClient}', '${other}', 'Org B');
        insert into public.reports values ('${report}', '${org}', '${client}');
    `);
    await db.exec(migration);
    return db;
}

async function asOrg(db: PGlite, organizationId: string) {
    await db.exec('reset role');
    await db.exec(`select set_config('test.org', '${organizationId}', false)`);
    await db.exec('set role authenticated');
}

test('migration 117 is unapplied, mirrored, and does not turn the flag on', () => {
    assert.equal(migration.includes('NOT APPLIED'), true);
    assert.equal(migration.includes('Not applied in this change'), true);
    assert.equal(/semrush/i.test(migration), false);
    assert.equal(schema.includes(migration.trim()), true);
    assert.match(envExample, /^NEXT_PUBLIC_KEYWORD_TRACKING=$/m);
    assert.equal(envExample.includes('NEXT_PUBLIC_KEYWORD_TRACKING=true'), false);
});

test('snapshots are org scoped, service role cannot write, and nothing is seeded', async () => {
    const db = await database();
    try {
        const empty = await db.query<{ n: number }>(`select count(*)::int as n from public.report_tracking_snapshots`);
        assert.equal(empty.rows[0].n, 0);
        await assert.rejects(
            db.query(`insert into public.report_tracking_snapshots (organization_id, client_id, report_id, payload) values ($1, $2, $3, '[]'::jsonb)`, [org, client, report]),
            /report_tracking_snapshots_payload_object/,
        );

        await db.query(
            `insert into public.report_tracking_snapshots (organization_id, client_id, report_id, payload) values ($1, $2, $3, $4::jsonb)`,
            [org, client, report, payload],
        );

        await asOrg(db, org);
        const own = await db.query<{ n: number }>(`select count(*)::int as n from public.report_tracking_snapshots`);
        assert.equal(own.rows[0].n, 1);
        const updated = await db.query(
            `update public.report_tracking_snapshots set payload = payload || '{"replaced":true}'::jsonb where report_id = $1 returning id`,
            [report],
        );
        assert.equal(updated.rows.length, 1);

        await asOrg(db, other);
        const hidden = await db.query<{ n: number }>(`select count(*)::int as n from public.report_tracking_snapshots`);
        assert.equal(hidden.rows[0].n, 0);
        await assert.rejects(
            db.query(
                `insert into public.report_tracking_snapshots (organization_id, client_id, report_id, payload) values ($1, $2, $3, $4::jsonb)`,
                [org, client, report, payload],
            ),
            /row-level security/,
        );

        await db.exec('reset role');
        await db.exec('set role service_role');
        const readable = await db.query<{ n: number }>(`select count(*)::int as n from public.report_tracking_snapshots`);
        assert.equal(readable.rows[0].n, 1);
        await assert.rejects(
            db.query(
                `insert into public.report_tracking_snapshots (organization_id, client_id, report_id, payload) values ($1, $2, $3, '{"schemaVersion":1}'::jsonb)`,
                [org, client, report],
            ),
            /permission denied/,
        );
        await assert.rejects(
            db.query(`update public.report_tracking_snapshots set captured_at = now()`),
            /permission denied/,
        );

        await db.exec('reset role');
        await db.exec('set role anon');
        await assert.rejects(db.query(`select * from public.report_tracking_snapshots`), /permission denied/);
    } finally {
        await db.close();
    }
});

test('a snapshot must belong to the report client and cannot move organizations', async () => {
    const db = await database();
    try {
        await assert.rejects(
            db.query(
                `insert into public.report_tracking_snapshots (organization_id, client_id, report_id, payload) values ($1, $2, $3, '{"schemaVersion":1}'::jsonb)`,
                [org, otherClient, report],
            ),
            /Client does not belong to this organization|Report does not belong to this client/,
        );
        const inserted = await db.query<{ id: string }>(
            `insert into public.report_tracking_snapshots (organization_id, client_id, report_id, payload) values ($1, $2, $3, '{"schemaVersion":1}'::jsonb) returning id`,
            [org, client, report],
        );
        await assert.rejects(
            db.query(`update public.report_tracking_snapshots set organization_id = $1 where id = $2`, [other, inserted.rows[0].id]),
            /stay on their report/,
        );
    } finally {
        await db.close();
    }
});

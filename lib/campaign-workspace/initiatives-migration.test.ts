import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/116_campaign_initiatives.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
const envExample = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8');

const org = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const client = '33333333-3333-4333-8333-333333333333';
const otherClient = '44444444-4444-4444-8444-444444444444';

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
        insert into public.organizations values ('${org}'), ('${other}');
        insert into public.clients values
            ('${client}', '${org}', 'Harbor Dental'),
            ('${otherClient}', '${other}', 'Other Client');
    `);
    await db.exec(migration);
    return db;
}

async function asOrg(db: PGlite, organizationId: string) {
    await db.exec('reset role');
    await db.exec(`select set_config('test.org', '${organizationId}', false)`);
    await db.exec('set role authenticated');
}

test('migration 116 is unapplied, mirrored, and does not turn the flag on', () => {
    assert.equal(migration.includes('NOT APPLIED'), true);
    assert.equal(migration.includes('Not applied in this change'), true);
    assert.equal(/campaign_plans|tracked_keywords|public\.tasks|public\.deliverables/.test(migration), false);
    assert.equal(/insert into public\.campaign_initiatives/i.test(migration), false);
    assert.equal(schema.includes(migration.trim()), true);
    assert.match(envExample, /^NEXT_PUBLIC_CAMPAIGN_WORKSPACE=$/m);
    assert.equal(envExample.includes('NEXT_PUBLIC_CAMPAIGN_WORKSPACE=true'), false);
    assert.equal(vercel.includes('CAMPAIGN_WORKSPACE'), false);
});

test('initiatives are org scoped, unseeded, and cannot store a verified win without evidence', async () => {
    const db = await database();
    try {
        await db.exec(migration);
        const empty = await db.query<{ n: number }>(
            `select (
                (select count(*) from public.campaign_initiatives)
                + (select count(*) from public.campaign_initiative_items)
            )::int as n`,
        );
        assert.equal(empty.rows[0].n, 0);

        const created = await db.query<{ id: string }>(
            `insert into public.campaign_initiatives (
                organization_id, client_id, title, purpose, owner_name, priority, state, starts_on, ends_on, evidence_url, verified_on
             ) values ($1, $2, 'Profile categories', 'Help patients recognize the practice', 'Alex Kim', 2, 'completed_verified', '2026-10-03', '2026-10-04', 'https://harbor.example/proof/profile', '2026-10-04')
             returning id`,
            [org, client],
        );
        const initiativeId = created.rows[0].id;
        await db.query(
            `insert into public.campaign_initiative_items (
                organization_id, client_id, initiative_id, title, content_state, live_url, published_on, position
             ) values ($1, $2, $3, 'Category update', 'published', 'https://harbor.example/blog/categories', '2026-10-04', 0)`,
            [org, client, initiativeId],
        );

        await assert.rejects(
            db.query(
                `insert into public.campaign_initiatives (organization_id, client_id, title, state)
                 values ($1, $2, 'Unproven cleanup', 'completed_verified')`,
                [org, client],
            ),
            /completed_verified|check/i,
        );
        await assert.rejects(
            db.query(
                `insert into public.campaign_initiatives (
                    organization_id, client_id, title, state, evidence_url, verified_on
                 ) values ($1, $2, 'Script proof', 'completed_verified', 'javascript:alert(1)', '2026-10-04')`,
                [org, client],
            ),
            /check/i,
        );
        await assert.rejects(
            db.query(
                `insert into public.campaign_initiative_items (
                    organization_id, client_id, initiative_id, title, content_state
                 ) values ($1, $2, $3, 'Missing live URL', 'published')`,
                [org, client, initiativeId],
            ),
            /published|check/i,
        );
        await assert.rejects(
            db.query(
                `insert into public.campaign_initiatives (organization_id, client_id, title, state)
                 values ($1, $2, 'Wrong org', 'planned')`,
                [other, client],
            ),
            /does not belong/i,
        );

        await asOrg(db, org);
        assert.equal((await db.query<{ n: number }>('select count(*)::int as n from public.campaign_initiatives')).rows[0].n, 1);
        assert.equal((await db.query<{ n: number }>('select count(*)::int as n from public.campaign_initiative_items')).rows[0].n, 1);

        await asOrg(db, other);
        assert.equal((await db.query<{ n: number }>('select count(*)::int as n from public.campaign_initiatives')).rows[0].n, 0);
        const planted = await db.query(
            `update public.campaign_initiatives set title = 'stolen' where organization_id = $1 returning id`,
            [org],
        );
        assert.equal(planted.rows.length, 0);
        await assert.rejects(
            db.query(
                `insert into public.campaign_initiatives (organization_id, client_id, title, state)
                 values ($1, $2, 'Planted', 'planned')`,
                [org, client],
            ),
            /row-level security/,
        );

        await db.exec('reset role');
        await db.exec('set role anon');
        await assert.rejects(db.query('select * from public.campaign_initiatives'), /permission denied/);
        await assert.rejects(db.query('select * from public.campaign_initiative_items'), /permission denied/);

        await db.exec('reset role');
        await db.query(`delete from public.clients where id = $1`, [client]);
        const remaining = await db.query<{ n: number }>('select count(*)::int as n from public.campaign_initiatives');
        assert.equal(remaining.rows[0].n, 0);
    } finally {
        await db.close();
    }
});

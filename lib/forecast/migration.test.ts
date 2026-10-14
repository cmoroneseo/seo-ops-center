import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { CAMPAIGN_DESK_MEG_ORG_ID } from './flags.ts';

const migration = readFileSync(new URL('../../migrations/095_campaign_desk_sync_runs.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const org = '22222222-2222-4222-8222-222222222222';
const user = '11111111-1111-4111-8111-111111111111';
const hash = 'a'.repeat(64);

test('migration 095 is additive, unapplied, and mirrored into schema.sql', () => {
    assert.match(migration, /Not applied in this change/);
    assert.equal(/security definer/i.test(migration), false);
    assert.equal(/alter table\s+public\.time_logs/i.test(migration), false);
    assert.equal(/alter table\s+public\.tasks/i.test(migration), false);
    assert.equal(/alter table\s+public\.planner_events/i.test(migration), false);
    assert.equal(/insert into/i.test(migration), false);
    assert.equal(migration.includes(CAMPAIGN_DESK_MEG_ORG_ID), false);
    assert.equal(schema.includes(migration.trim()), true);
});

test('a live payload can be stored once, undone, and stored again', async () => {
    const db = new PGlite();
    try {
        await db.exec(`
            create schema if not exists auth;
            create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
            create role anon;
            create role authenticated;
            create role service_role bypassrls;
            create table public.organizations(id uuid primary key);
            create table public.users(id uuid primary key);
            create table public.organization_members(organization_id uuid, user_id uuid, role text);
            create or replace function public.get_user_org_ids() returns setof uuid language sql stable as $$ select null::uuid where false $$;
        `);
        await db.exec(migration);
        await db.query('insert into public.organizations(id) values ($1)', [org]);
        await db.query('insert into public.users(id) values ($1)', [user]);
        await db.exec('set role service_role');
        const payload = { source: 'seo-ops-center', organizationId: org, weeks: [] };
        await db.query(
            `insert into public.campaign_desk_sync_runs
                (organization_id, created_by, week_starts, payload_hash, payload, status)
             values ($1, $2, $3, $4, $5::jsonb, 'succeeded')`,
            [org, user, ['2026-10-12'], hash, JSON.stringify(payload)],
        );
        await assert.rejects(db.query(
            `insert into public.campaign_desk_sync_runs
                (organization_id, created_by, week_starts, payload_hash, payload, status)
             values ($1, $2, $3, $4, $5::jsonb, 'succeeded')`,
            [org, user, ['2026-10-12'], hash, JSON.stringify(payload)],
        ), /unique|duplicate/i);
        await assert.rejects(db.query(
            `insert into public.campaign_desk_sync_runs
                (organization_id, created_by, week_starts, payload_hash, payload, status)
             values ($1, $2, $3, $4, $5::jsonb, 'succeeded')`,
            [org, user, ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'], 'b'.repeat(64), JSON.stringify(payload)],
        ), /check|cardinality/i);
        await db.query(
            `update public.campaign_desk_sync_runs
             set status = 'undone', undone_at = now(), undone_by = $1
             where payload_hash = $2`,
            [user, hash],
        );
        await db.query(
            `insert into public.campaign_desk_sync_runs
                (organization_id, created_by, week_starts, payload_hash, payload, status)
             values ($1, $2, $3, $4, $5::jsonb, 'succeeded')`,
            [org, user, ['2026-10-12'], hash, JSON.stringify(payload)],
        );
        await db.exec('reset role');
        await db.exec('set role anon');
        await assert.rejects(db.query('select * from public.campaign_desk_sync_runs'), /permission denied/i);
        await db.exec('reset role');
        await db.exec('grant select on public.organization_members to authenticated');
        await db.exec('set role authenticated');
        const visible = await db.query('select id from public.campaign_desk_sync_runs');
        assert.equal(visible.rows.length, 0);
    } finally {
        await db.close();
    }
});

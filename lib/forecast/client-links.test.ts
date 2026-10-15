import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { suggestCampaignDeskClientId, presentClientMap, nameMatchesToRemember } from './clients.ts';
import { createForecastClientLinksGet, createForecastClientLinksPut, type ForecastClientMapDependencies } from './client-map-http.ts';
import { CAMPAIGN_DESK_MEG_ORG_ID } from './flags.ts';
import { ForecastClientMapUnavailable } from './store.ts';

const migration = readFileSync(new URL('../../migrations/099_campaign_desk_client_links.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

test('migration 099 is a new table only, unapplied, and mirrored into schema.sql', () => {
    assert.match(migration, /Not applied in this change/);
    assert.equal(/alter table\s+public\.clients/i.test(migration), false);
    assert.equal(/alter table\s+public\.time_logs/i.test(migration), false);
    assert.equal(/alter table\s+public\.tasks/i.test(migration), false);
    assert.equal(/alter table\s+public\.planner_events/i.test(migration), false);
    assert.equal(/alter table\s+public\.campaign_desk_sync_runs/i.test(migration), false);
    assert.equal(/insert into/i.test(migration), false);
    assert.equal(migration.includes(CAMPAIGN_DESK_MEG_ORG_ID), false);
    assert.equal(schema.includes(migration.trim()), true);
});

test('the map stores one link per client and hides rows from anon', async () => {
    const db = new PGlite();
    const org = '22222222-2222-4222-8222-222222222222';
    const user = '11111111-1111-4111-8111-111111111111';
    const client = '33333333-3333-4333-8333-333333333333';
    try {
        await db.exec(`
            create schema if not exists auth;
            create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
            create role anon;
            create role authenticated;
            create role service_role bypassrls;
            create table public.organizations(id uuid primary key);
            create table public.users(id uuid primary key);
            create table public.clients(id uuid primary key, organization_id uuid references public.organizations(id));
            create table public.organization_members(organization_id uuid, user_id uuid, role text);
            create or replace function public.get_user_org_ids() returns setof uuid language sql stable as $$ select null::uuid where false $$;
        `);
        await db.exec(migration);
        await db.query('insert into public.organizations(id) values ($1)', [org]);
        await db.query('insert into public.users(id) values ($1)', [user]);
        await db.query('insert into public.clients(id, organization_id) values ($1, $2)', [client, org]);
        await db.exec('set role service_role');
        await db.query(
            `insert into public.campaign_desk_client_links
                (organization_id, client_id, campaign_desk_client_id, matched_by, updated_by)
             values ($1, $2, 'rc_pipe', 'name', $3)`,
            [org, client, user],
        );
        await assert.rejects(db.query(
            `insert into public.campaign_desk_client_links
                (organization_id, client_id, campaign_desk_client_id, matched_by, updated_by)
             values ($1, $2, 'rc_other', 'manual', $3)`,
            [org, client, user],
        ), /unique|duplicate/i);
        await assert.rejects(db.query(
            `insert into public.campaign_desk_client_links
                (organization_id, client_id, campaign_desk_client_id, matched_by)
             values ($1, $2, 'rc_bad', 'guess')`,
            [org, client],
        ), /check/i);
        await db.exec('reset role');
        await db.exec('set role anon');
        await assert.rejects(db.query('select * from public.campaign_desk_client_links'), /permission denied/i);
        await db.exec('reset role');
        await db.exec('grant select on public.organization_members to authenticated');
        await db.exec('set role authenticated');
        const visible = await db.query('select client_id from public.campaign_desk_client_links');
        assert.equal(visible.rows.length, 0);
    } finally {
        await db.close();
    }
});

test('exact name suggests one client and the admin route can save a different one', async () => {
    assert.equal(suggestCampaignDeskClientId('Pipe It Right', [
        { id: 'rc_pipe', name: 'Pipe It Right' },
        { id: 'rc_other', name: 'pipe it right' },
    ]), 'rc_pipe');
    assert.equal(suggestCampaignDeskClientId('Pipe It Right', [
        { id: 'rc_a', name: 'Pipe It Right' },
        { id: 'rc_b', name: 'Pipe It Right' },
    ]), null);

    const org = '22222222-2222-4222-8222-222222222222';
    const seo = '33333333-3333-4333-8333-333333333333';
    const links: { clientId: string; campaignDeskClientId: string; matchedBy: 'manual' | 'name' }[] = [];
    const deps: ForecastClientMapDependencies = {
        async authorize(organizationId) {
            return {
                ok: true,
                userId: '11111111-1111-4111-8111-111111111111',
                actorName: 'Carlos Morones',
                organizationId,
                role: 'owner',
            };
        },
        readiness: () => ({ enabled: true, reason: null }),
        payloadVersion: () => 2,
        async listSeoClients() {
            return [{ id: seo, name: 'Pipe It Right', domain: 'pipeitright.com' }];
        },
        async loadClientLinks() { return links; },
        async listDeskClients() {
            return [{ id: 'rc_pipe', name: 'Pipe It Right' }, { id: 'rc_other', name: 'Other' }];
        },
        async saveClientLink(input) {
            const existing = links.findIndex(link => link.clientId === input.clientId);
            const row = {
                clientId: input.clientId,
                campaignDeskClientId: input.campaignDeskClientId,
                matchedBy: input.matchedBy,
            };
            if (existing >= 0) links[existing] = row;
            else links.push(row);
        },
        async clearClientLink(_organizationId, clientId) {
            const index = links.findIndex(link => link.clientId === clientId);
            if (index >= 0) links.splice(index, 1);
        },
    };

    const listed = await (await createForecastClientLinksGet(deps)(
        new Request(`https://seo-pm.test/api/forecast/client-links?organizationId=${org}`),
    )).json();
    assert.equal(listed.rows[0].suggestionId, 'rc_pipe');
    assert.equal(listed.rows[0].effectiveId, 'rc_pipe');
    assert.equal(listed.rows[0].domain, 'pipeitright.com');
    assert.deepEqual(nameMatchesToRemember(
        [{ id: seo, name: 'Pipe It Right', domain: null }],
        new Map(),
        [{ id: 'rc_pipe', name: 'Pipe It Right' }],
    ), [{ clientId: seo, campaignDeskClientId: 'rc_pipe' }]);

    const saved = await (await createForecastClientLinksPut(deps)(new Request('https://seo-pm.test/api/forecast/client-links', {
        method: 'PUT',
        body: JSON.stringify({ organizationId: org, clientId: seo, campaignDeskClientId: 'rc_other' }),
    }))).json();
    assert.equal(saved.rows[0].savedId, 'rc_other');
    assert.equal(saved.rows[0].matchedBy, 'manual');
    assert.equal(presentClientMap({
        seoClients: [{ id: seo, name: 'Pipe It Right', domain: 'pipeitright.com' }],
        links,
        deskClients: [{ id: 'rc_pipe', name: 'Pipe It Right' }, { id: 'rc_other', name: 'Other' }],
    }).rows[0].effectiveId, 'rc_other');

    deps.loadClientLinks = async () => { throw new ForecastClientMapUnavailable(); };
    const missing = await createForecastClientLinksGet(deps)(
        new Request(`https://seo-pm.test/api/forecast/client-links?organizationId=${org}`),
    );
    assert.equal(missing.status, 200);
    assert.equal((await missing.json()).storageReady, false);
});

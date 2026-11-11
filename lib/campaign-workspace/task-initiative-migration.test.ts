import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import { linkedTaskProgress, type PartOfTask } from '../tasks/part-of.ts';

const base = readFileSync(new URL('../../migrations/116_campaign_initiatives.sql', import.meta.url), 'utf8');
const story = readFileSync(new URL('../../migrations/118_campaign_initiative_roadmap_fields.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../migrations/126_task_initiative_link.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const org = '11111111-1111-4111-8111-111111111111';
const otherOrg = '22222222-2222-4222-8222-222222222222';
const client = '33333333-3333-4333-8333-333333333333';
const otherClient = '44444444-4444-4444-8444-444444444444';
const foreignClient = '55555555-5555-4555-8555-555555555555';
const page = '66666666-6666-4666-8666-666666666666';
const proof = '77777777-7777-4777-8777-777777777777';
const child = '88888888-8888-4888-8888-888888888888';
const outsider = '99999999-9999-4999-8999-999999999999';

async function database() {
    const db = new PGlite();
    await db.exec(`
        create role anon;
        create role authenticated;
        create role service_role bypassrls;
        create function public.get_user_org_ids() returns setof uuid
        language sql stable security definer as $$
          select null::uuid where false
        $$;
        create table public.organizations(id uuid primary key);
        create table public.clients(
            id uuid primary key,
            organization_id uuid not null references public.organizations(id) on delete cascade,
            name text not null
        );
        create table public.tasks (
            id uuid primary key,
            organization_id uuid not null,
            client_id uuid,
            parent_task_id uuid,
            title text not null,
            status text not null default 'todo'
        );
        insert into public.organizations values ('${org}'), ('${otherOrg}');
        insert into public.clients values
            ('${client}', '${org}', 'Harbor Dental'),
            ('${otherClient}', '${org}', 'Other Harbor'),
            ('${foreignClient}', '${otherOrg}', 'Other Org');
    `);
    await db.exec(base);
    await db.exec(story);
    await db.exec(migration);
    return db;
}

test('migration 126 is unapplied, mirrored, and does not change task policies', () => {
    assert.equal(migration.includes('NOT APPLIED'), true);
    assert.equal(migration.includes('Not applied in this change'), true);
    assert.equal(/insert into/i.test(migration), false);
    assert.equal(/create policy|enable row level security|drop policy/i.test(migration), false);
    assert.match(migration, /on delete set null \(initiative_id\)/i);
    assert.match(migration, /tasks_initiative_id_idx/);
    assert.equal(schema.includes(migration.trim()), true);
});

test('a task links and unlinks only inside its client, and deleting the row clears the link', async () => {
    const db = await database();
    try {
        await db.exec(migration);
        const rank = await db.query<{ id: string }>(
            `insert into public.campaign_initiatives (organization_id, client_id, title, state)
             values ($1, $2, 'Rank the service pages', 'planned')
             returning id`,
            [org, client],
        );
        const rankId = rank.rows[0].id;
        const elsewhere = await db.query<{ id: string }>(
            `insert into public.campaign_initiatives (organization_id, client_id, title, state)
             values ($1, $2, 'Other client page', 'planned')
             returning id`,
            [org, otherClient],
        );
        const otherId = elsewhere.rows[0].id;

        await db.query(
            `insert into public.tasks (id, organization_id, client_id, title, status, initiative_id)
             values ($1, $2, $3, 'Rewrite the service page', 'todo', $4),
                    ($5, $2, $3, 'Publish the proof', 'done', $4)`,
            [page, org, client, rankId, proof],
        );
        await db.query(
            `insert into public.tasks (id, organization_id, client_id, parent_task_id, title, status, initiative_id)
             values ($1, $2, $3, $4, 'Check one heading', 'done', $5)`,
            [child, org, client, page, rankId],
        );
        const nested = await db.query<{ initiative_id: string | null }>(
            'select initiative_id from public.tasks where id = $1',
            [child],
        );
        assert.equal(nested.rows[0].initiative_id, null);

        const linked = await db.query<{ id: string; title: string; status: string; parent_task_id: string | null; initiative_id: string | null }>(
            `select id::text, title, status, parent_task_id::text, initiative_id::text
             from public.tasks
             where client_id = $1
             order by title`,
            [client],
        );
        const progressTasks: PartOfTask[] = linked.rows.map(row => ({
            id: row.id,
            title: row.title,
            status: row.status,
            parentTaskId: row.parent_task_id,
            initiativeId: row.initiative_id,
        }));
        const progress = linkedTaskProgress(rankId, progressTasks);
        assert.ok(progress);
        assert.equal(progress.label, '1 of 2 tasks done');
        assert.deepEqual(progress.tasks.map(task => task.title), ['Publish the proof', 'Rewrite the service page']);

        await assert.rejects(
            db.query(
                `insert into public.tasks (id, organization_id, client_id, title, initiative_id)
                 values ($1, $2, $3, 'Wrong client', $4)`,
                [outsider, org, otherClient, rankId],
            ),
            /foreign key|tasks_initiative_fkey/i,
        );
        await assert.rejects(
            db.query('update public.tasks set initiative_id = $1 where id = $2', [otherId, page]),
            /foreign key|tasks_initiative_fkey/i,
        );
        await assert.rejects(
            db.query(
                `insert into public.tasks (id, organization_id, title, initiative_id)
                 values ($1, $2, 'No client', $3)`,
                ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', org, rankId],
            ),
            /tasks_initiative_client_check|check/i,
        );

        const unlinked = await db.query<{ initiative_id: string | null; title: string }>(
            `update public.tasks set initiative_id = null where id = $1
             returning initiative_id, title`,
            [page],
        );
        assert.equal(unlinked.rows[0].initiative_id, null);
        assert.equal(unlinked.rows[0].title, 'Rewrite the service page');

        await db.query('update public.tasks set initiative_id = $1 where id = $2', [rankId, page]);
        await db.query('delete from public.campaign_initiatives where id = $1', [rankId]);
        const cleared = await db.query<{ id: string; initiative_id: string | null; organization_id: string; client_id: string; title: string }>(
            `select id::text, initiative_id::text, organization_id::text, client_id::text, title
             from public.tasks
             where id in ($1, $2)
             order by title`,
            [page, proof],
        );
        assert.equal(cleared.rows.length, 2);
        for (const row of cleared.rows) {
            assert.equal(row.initiative_id, null);
            assert.equal(row.organization_id, org);
            assert.equal(row.client_id, client);
        }
        const remaining = await db.query<{ n: number }>(
            'select count(*)::int as n from public.tasks where initiative_id = $1',
            [rankId],
        );
        assert.equal(remaining.rows[0].n, 0);

        const policies = await db.query<{ n: number }>(
            `select count(*)::int as n from pg_policy where polrelid = 'public.tasks'::regclass`,
        );
        assert.equal(policies.rows[0].n, 0);
    } finally {
        await db.close();
    }
});

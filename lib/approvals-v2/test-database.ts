import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/131_gbp_approval_requests.sql', import.meta.url), 'utf8');

const org = '11111111-1111-4111-8111-111111111111';
const otherOrg = '22222222-2222-4222-8222-222222222222';
const owner = '360c97ac-54fc-41fb-b660-0566d63c2e1b';
const assignee = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const viewer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const member = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const client = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherClient = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const task = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const otherTask = '99999999-9999-4999-8999-999999999999';
const now = '2026-11-14T17:00:00.000Z';
const later = '2026-11-20T17:00:00.000Z';
const expiry = '2026-11-28T17:00:00.000Z';

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function post(title: string, scheduled = '2026-11-16') {
    return {
        position: 1,
        photoPath: 'https://allinone-const.com/photos/post.jpg',
        payload: {
            schemaVersion: 1,
            postType: 'offer',
            title,
            body: 'Happy Thanksgiving from everyone at ALL-IN-1 Construction in Banning, CA. Once the leftovers are gone, tap below to request your free walkthrough.',
            offerStart: scheduled,
            offerEnd: '2026-12-31',
            scheduledDate: scheduled,
            ctaUrl: 'https://allinone-const.com/contact/',
            ctaLabel: 'View offer',
            terms: 'Offer runs Nov 16 to Dec 31.',
        },
    };
}

async function database(version = '132') {
    const db = new PGlite();
    await db.exec(`
        create role anon nologin;
        create role authenticated nologin;
        create role service_role nologin bypassrls;
        create schema auth;
        create function auth.uid() returns uuid language sql stable as $$
            select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
        create function public.get_user_org_ids() returns setof uuid language sql stable as $$
            select nullif(current_setting('test.org', true), '')::uuid
        $$;
        create schema storage;
        create table storage.buckets (
            id text primary key,
            name text,
            public boolean,
            file_size_limit bigint,
            allowed_mime_types text[]
        );
        create table storage.objects (
            id uuid primary key default gen_random_uuid(),
            bucket_id text,
            name text
        );
        alter table storage.objects enable row level security;
        create table public.organizations(id uuid primary key);
        create table public.clients(
            id uuid primary key,
            organization_id uuid not null references public.organizations(id),
            name text not null
        );
        create table public.tasks(
            id uuid primary key,
            organization_id uuid not null references public.organizations(id),
            client_id uuid not null references public.clients(id),
            title text not null,
            status text not null default 'todo',
            due_date timestamptz,
            assignee_ids uuid[] not null default '{}',
            status_history jsonb not null default '[]'::jsonb
        );
        create table public.organization_members(
            organization_id uuid,
            user_id uuid,
            role text
        );
        create table public.notifications (
            id uuid primary key default gen_random_uuid(),
            organization_id uuid not null,
            user_id uuid not null,
            type text not null,
            title text not null,
            body text,
            entity_type text,
            entity_id text,
            client_id uuid,
            is_read boolean not null default false,
            created_at timestamptz not null default now(),
            constraint notifications_type_check check (type in ('task_assigned')),
            constraint notifications_entity_type_check check (entity_type in ('task'))
        );
        insert into public.organizations values ('${org}'), ('${otherOrg}');
        insert into public.clients values
            ('${client}', '${org}', 'ALL-IN-1 Construction'),
            ('${otherClient}', '${otherOrg}', 'Other Client');
        insert into public.tasks (id, organization_id, client_id, title, due_date, assignee_ids) values
            ('${task}', '${org}', '${client}', 'GBP holiday posts', '2026-11-15T08:00:00Z', '{${assignee}}'),
            ('${otherTask}', '${otherOrg}', '${otherClient}', 'Other task', null, '{}');
        insert into public.organization_members values
            ('${org}', '${owner}', 'owner'),
            ('${otherOrg}', '${owner}', 'owner'),
            ('${org}', '${assignee}', 'member'),
            ('${org}', '${member}', 'member'),
            ('${org}', '${viewer}', 'viewer');
        grant usage on schema public to anon, authenticated, service_role;
    `);
    await db.exec(migration);
    {
        await db.exec(`create table public.users(id uuid primary key);
            insert into public.users select distinct user_id from public.organization_members;
            create table public.bot_api_keys(id uuid primary key, organization_id uuid);
            alter table public.clients add column account_manager_id uuid;`);
        if (version === '132') await db.exec(readFileSync(new URL('../../migrations/132_approvals_v2.sql', import.meta.url), 'utf8'));
    }
    return db;
}

async function asRole(db: PGlite, role: string) {
    await db.exec(`set role ${role}`);
}

async function reset(db: PGlite) {
    await db.exec('reset role');
}

async function call(db: PGlite, sql: string, params: unknown[] = []) {
    await asRole(db, 'service_role');
    try {
        const result = await db.query<{ result: Record<string, unknown> }>(sql, params);
        const value = result.rows[0]?.result;
        return typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value;
    } finally {
        await reset(db);
    }
}


export { database, call, post, hash, org, otherOrg, owner, assignee, viewer, member, client, otherClient, task, otherTask, now, later, expiry };

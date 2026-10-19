import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/106_drop_client_agreements.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const org = '00000000-0000-0000-0000-000000000010';
const client = '00000000-0000-0000-0000-000000000020';

test('migration 106 is idempotent, mirrored, and leaves client fields in place', () => {
    assert.equal(schema.includes(migration.trim()), true);
    assert.match(migration, /drop table if exists public\.client_agreements/i);
    assert.match(migration, /drop table if exists public\.client_agreement_work_funding/i);
    assert.match(migration, /drop function if exists public\.preview_client_agreement\(uuid, date\)/i);
    assert.match(migration, /drop function if exists public\.confirm_client_agreement\(uuid, uuid, jsonb, text\)/i);
    assert.match(migration, /drop function if exists public\.cancel_scheduled_agreement\(uuid, uuid\)/i);
    assert.match(migration, /drop function if exists public\.agreement_review_token\(uuid\)/i);
    assert.match(migration, /drop trigger if exists/i);
    assert.doesNotMatch(migration, /seo_hours/);
    assert.doesNotMatch(migration, /drop table if exists public\.deliverable_commitments/i);
    assert.match(migration, /alter table public\.tasks[\s\S]*drop column if exists commitment_id/);
    assert.doesNotMatch(migration, /alter table public\.deliverables[\s\S]*commitment_id/);
    assert.doesNotMatch(migration, /alter table public\.deliverable_commitments[\s\S]*drop column if exists commitment_id/);
    assert.doesNotMatch(migration, /client_agreements where client_id/);
});

test('running the drop twice removes the engine and restores setup activation', async () => {
    const db = new PGlite();
    await db.exec(`
        create table public.clients (
            id uuid primary key,
            organization_id uuid,
            status text,
            launch_date date,
            onboarding_date date,
            setup_scope jsonb,
            seo_hours numeric
        );
        create table public.deliverable_commitments (
            id uuid primary key default gen_random_uuid(),
            organization_id uuid,
            client_id uuid,
            type text,
            title text,
            quantity_per_month numeric,
            cadence text,
            engagement_model text,
            starts_on date,
            is_active boolean,
            counts_toward_hours boolean,
            custom_fields jsonb,
            agreement_id uuid
        );
        create table public.tasks (
            id uuid primary key,
            client_id uuid,
            title text,
            agreement_id uuid,
            plan_phase text,
            plan_phase_locked boolean not null default false,
            commitment_id uuid
        );
        alter table public.tasks add constraint tasks_plan_phase_check check (
            plan_phase is null or plan_phase = 'onboarding' or plan_phase ~ '^month_[1-9][0-9]*$'
        );
        create index tasks_client_plan_phase_idx on public.tasks (client_id, plan_phase);
        create table public.time_logs (id uuid primary key, agreement_id uuid, date date);
        create index time_logs_agreement_period_idx on public.time_logs (agreement_id, date);
        create table public.deliverables (
            id uuid primary key,
            commitment_id uuid,
            agreement_id uuid,
            generation_key text
        );
        create unique index deliverables_generation_key_idx on public.deliverables (generation_key);
        create index commitments_agreement_idx on public.deliverable_commitments (agreement_id);
        create table public.client_agreements (id uuid primary key, client_id uuid);
        create table public.client_agreement_work_funding (id uuid primary key, task_id uuid);

        create function public.classify_agreement_time() returns trigger language plpgsql as $$ begin return new; end $$;
        create function public.assign_work_agreement() returns trigger language plpgsql as $$ begin return new; end $$;
        create function public.require_accepted_output_transaction() returns trigger language plpgsql as $$ begin return new; end $$;
        create function public.protect_agreement_commitment() returns trigger language plpgsql as $$ begin if tg_op = 'DELETE' then return old; end if; return new; end $$;
        create function public.protect_agreement_client_terms() returns trigger language plpgsql as $$ begin return new; end $$;
        create function public.guard_custom_agreement_generation() returns trigger language plpgsql as $$ begin return new; end $$;
        create function public.agreement_coverage_end(p_id uuid) returns date language sql as $$ select null::date $$;
        create function public.agreement_at_date(p_client uuid, p_date date) returns uuid language sql as $$ select null::uuid $$;
        create function public.agreement_review_token(p_client uuid) returns text language sql as $$ select 'token' $$;
        create function public.preview_client_agreement(p_client uuid, p_start date) returns jsonb language sql as $$ select '{}'::jsonb $$;
        create function public.confirm_client_agreement(p_client uuid, p_request uuid, p_input jsonb, p_token text) returns uuid language sql as $$ select p_request $$;
        create function public.cancel_scheduled_agreement(p_client uuid, p_id uuid) returns void language plpgsql as $$ begin return; end $$;
        create function public.activate_client_setup_scope() returns trigger language plpgsql as $$
        begin
            if exists (select 1 from public.client_agreements where client_id = new.id) then return new; end if;
            return new;
        end $$;

        create trigger time_logs_agreement_scope before insert or update on public.time_logs for each row execute function public.classify_agreement_time();
        create trigger tasks_agreement_origin before insert or update on public.tasks for each row execute function public.assign_work_agreement();
        create trigger deliverables_agreement_origin before insert or update on public.deliverables for each row execute function public.assign_work_agreement();
        create trigger deliverables_guard_custom_generation before insert on public.deliverables for each row execute function public.guard_custom_agreement_generation();
        create trigger commitments_agreement_origin before insert or update on public.deliverable_commitments for each row execute function public.assign_work_agreement();
        create trigger commitments_require_agreement_transaction before insert or update on public.deliverable_commitments for each row execute function public.require_accepted_output_transaction();
        create trigger commitments_protect_accepted_scope before update or delete on public.deliverable_commitments for each row execute function public.protect_agreement_commitment();
        create trigger clients_protect_agreement_terms before update on public.clients for each row execute function public.protect_agreement_client_terms();
        create trigger clients_activate_setup after update of status, launch_date, setup_scope on public.clients for each row execute function public.activate_client_setup_scope();
    `);
    await db.exec(`
        insert into public.clients (id, organization_id, status, onboarding_date, seo_hours, setup_scope)
        values ('${client}', '${org}', 'onboarding', '2020-01-01', 10, '{"version":"1","mode":"monthly","contentPieces":2}');
        insert into public.client_agreements (id, client_id) values ('00000000-0000-0000-0000-000000000030', '${client}');
        insert into public.deliverable_commitments (organization_id, client_id, type, title, quantity_per_month, cadence, engagement_model, starts_on, is_active, counts_toward_hours, custom_fields)
        values ('${org}', '${client}', 'Content', 'Content pieces', 2, 'monthly', 'Retainer', '2020-01-01', false, false, '{"setupManaged":true}');
        insert into public.tasks (id, title, plan_phase, commitment_id) values ('00000000-0000-0000-0000-000000000040', 'Rank tracking', 'month_1', '00000000-0000-0000-0000-000000000041');
    `);
    await db.exec(`update public.clients set status = 'active', launch_date = '2020-02-01' where id = '${client}'`);
    assert.equal((await db.query<{ is_active: boolean }>('select is_active from public.deliverable_commitments')).rows[0].is_active, false);

    await db.exec(migration);
    await db.exec(migration);

    await assert.rejects(db.query('select 1 from public.client_agreements'), /client_agreements/);
    await assert.rejects(db.query('select 1 from public.client_agreement_work_funding'), /client_agreement_work_funding/);
    const columns = (await db.query<{ table_name: string; column_name: string }>(`
        select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and column_name in ('agreement_id', 'generation_key', 'plan_phase', 'plan_phase_locked', 'commitment_id', 'seo_hours')
    `)).rows;
    assert.deepEqual(columns.map(row => `${row.table_name}.${row.column_name}`).sort(), [
        'clients.seo_hours',
        'deliverables.commitment_id',
    ]);
    const functions = (await db.query<{ proname: string }>(`
        select proname from pg_proc
        where proname in (
            'preview_client_agreement', 'confirm_client_agreement', 'cancel_scheduled_agreement',
            'agreement_review_token', 'agreement_coverage_end', 'protect_agreement_client_terms',
            'activate_client_setup_scope'
        )
    `)).rows.map(row => row.proname);
    assert.deepEqual(functions, ['activate_client_setup_scope']);
    const source = (await db.query<{ prosrc: string }>(`select prosrc from pg_proc where proname = 'activate_client_setup_scope'`)).rows[0].prosrc;
    assert.equal(source.includes('client_agreements'), false);
    const triggers = (await db.query<{ tgname: string }>(`
        select tgname from pg_trigger where not tgisinternal and tgname in (
            'time_logs_agreement_scope', 'clients_protect_agreement_terms', 'clients_activate_setup',
            'deliverables_guard_custom_generation', 'commitments_protect_accepted_scope'
        )
    `)).rows.map(row => row.tgname);
    assert.deepEqual(triggers, ['clients_activate_setup']);
    assert.equal(Number((await db.query<{ seo_hours: string }>('select seo_hours from public.clients')).rows[0].seo_hours), 10);

    await db.exec(`update public.clients set launch_date = '2020-03-01' where id = '${client}'`);
    const commitment = (await db.query<{ is_active: boolean; starts_on: string; quantity_per_month: number }>(
        'select is_active, starts_on::text, quantity_per_month from public.deliverable_commitments',
    )).rows[0];
    assert.equal(commitment.is_active, true);
    assert.equal(commitment.starts_on, '2020-03-01');
    assert.equal(Number(commitment.quantity_per_month), 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/073_metrics_integrity_and_sync_outcomes.sql', import.meta.url), 'utf8');
const org = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const client = '33333333-3333-4333-8333-333333333333';

async function database(seedDuplicates = false) {
    const db = new PGlite();
    await db.exec(`
        create role anon;
        create role authenticated;
        create role service_role bypassrls;
        create table organizations (id uuid primary key);
        create table users (id uuid primary key);
        create table projects (id uuid primary key, organization_id uuid);
        create table clients (id uuid primary key, organization_id uuid not null);
        create table metrics (
            id uuid primary key default gen_random_uuid(),
            organization_id uuid not null,
            project_id uuid,
            date date not null,
            source text not null check (source in ('gsc', 'ga4', 'gbp', 'ahrefs')),
            data jsonb not null,
            created_at timestamptz not null default now(),
            client_id uuid,
            metric_month text,
            sync_run_id uuid,
            source_type text default 'auto' check (source_type in ('auto', 'manual'))
        );
        create table sync_runs (
            id uuid primary key default gen_random_uuid(),
            organization_id uuid not null,
            started_at timestamptz not null default now(),
            finished_at timestamptz,
            status text default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
            clients_synced integer default 0,
            clients_errored integer default 0,
            error_summary jsonb default '[]'::jsonb,
            created_at timestamptz not null default now()
        );
        insert into organizations values ('${org}'), ('${other}');
        insert into clients values ('${client}', '${org}');
    `);
    if (seedDuplicates) {
        await db.exec(`
            insert into metrics (organization_id, date, source, data, client_id, metric_month)
            values ('${org}', '2026-01-01', 'gsc', '{}', '${client}', '2026-01'),
                   ('${org}', '2026-01-01', 'gsc', '{}', '${client}', '2026-01');
        `);
    }
    return db;
}

function write(db: PGlite, sourceType: 'auto' | 'manual', data: Record<string, number>, month = '2026-10', organization = org) {
    return db.query<{ write_metric: string }>(
        `select write_metric($1,$2,'gsc',$3,$4::jsonb,$5,null,null) as write_metric`,
        [organization, client, month, JSON.stringify(data), sourceType],
    );
}

test('write_metric inserts, updates, and refuses to downgrade a manual row', async () => {
    const db = await database();
    try {
        await db.exec(migration);
        assert.equal((await write(db, 'auto', { organic_clicks: 1 })).rows[0].write_metric, 'inserted');
        assert.equal((await write(db, 'auto', { organic_clicks: 2 })).rows[0].write_metric, 'updated');
        assert.equal((await write(db, 'manual', { organic_clicks: 9 })).rows[0].write_metric, 'updated');
        const manual = (await db.query<{ source_type: string; data: { organic_clicks: number } }>(
            'select source_type, data from metrics',
        )).rows[0];
        assert.equal(manual.source_type, 'manual');
        assert.equal((await write(db, 'auto', { organic_clicks: 3 })).rows[0].write_metric, 'skipped_manual');
        const kept = (await db.query<{ data: { organic_clicks: number } }>('select data from metrics')).rows[0];
        assert.equal(kept.data.organic_clicks, 9);
        await assert.rejects(
            db.query("update metrics set source_type = 'auto'"),
            /manual rows cannot be overwritten/,
        );
        await assert.rejects(
            db.exec(`insert into metrics (organization_id, date, source, data, client_id, metric_month)
                values ('${org}', '2026-10-01', 'gsc', '{}', '${client}', '2026-10')`),
            /duplicate key/,
        );
        await assert.rejects(write(db, 'auto', { organic_clicks: 1 }, '2026-10', other), /does not belong to organization/);
        await assert.rejects(write(db, 'auto', { organic_clicks: 1 }, '2026-13'), /invalid month/);
        await db.exec('set role authenticated');
        await assert.rejects(write(db, 'auto', { organic_clicks: 1 }), /permission denied/);
    } finally {
        await db.close();
    }
});

test('existing duplicate metrics abort the migration', async () => {
    const db = await database(true);
    try {
        await assert.rejects(db.exec(migration), /duplicate metrics/);
    } finally {
        await db.close();
    }
});

test('schema.sql mirrors the metrics integrity migration', () => {
    const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    assert.equal(schema.includes(migration), true);
});

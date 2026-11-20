import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/135_sheet_sync_runs.sql', import.meta.url), 'utf8');
const org = '00000000-0000-4000-a000-000000000001';
const otherOrg = '00000000-0000-4000-a000-000000000002';
const client = '00000000-0000-4000-a000-000000000003';
const actor = '00000000-0000-4000-a000-000000000004';
const run = '00000000-0000-4000-a000-000000000005';
const next = '00000000-0000-4000-a000-000000000006';

test('135 is rerunnable, restricts reads and writes, and atomically reserves and rate-limits runs', async () => {
    const db = new PGlite();
    try {
        await db.exec(`
            create role anon;
            create role authenticated;
            create role service_role bypassrls;
            create table organizations (id uuid primary key);
            create table users (id uuid primary key);
            create table clients (id uuid primary key, organization_id uuid references organizations(id), roadmap_sheet_id text);
            grant select, update on clients to service_role;
            create function get_user_org_ids() returns setof uuid language sql as $$ select '${org}'::uuid $$;
            insert into organizations values ('${org}'), ('${otherOrg}');
            insert into users values ('${actor}');
            insert into clients values ('${client}', '${org}', 'sheet');
        `);
        await db.exec(migration);
        await db.exec(migration);

        const reserve = async (id: string, trigger: string) => {
            const result = await db.query<{ result: string }>(
                'select reserve_sheet_sync_run($1,$2,$3,$4,$5,$6) result',
                [id, client, org, 'sheet', trigger, actor],
            );
            return result.rows[0].result;
        };
        await db.exec('set role service_role');
        assert.equal(await reserve(run, 'manual'), 'reserved');
        assert.equal(await reserve(run, 'manual'), 'duplicate');
        assert.equal(await reserve(next, 'manual'), 'rate_limited');
        assert.equal(await reserve(next, 'cron'), 'busy');
        await db.exec("update sheet_sync_runs set started_at = now() - interval '7 minutes'");
        assert.equal(await reserve(next, 'manual'), 'reserved');
        assert.deepEqual((await db.query('select status, error, rows_written from sheet_sync_runs order by started_at')).rows, [
            { status: 'failed', error: 'Sheet mirror timed out', rows_written: {} },
            { status: 'running', error: null, rows_written: {} },
        ]);
        await db.exec('reset role');

        const insert = (organizationId: string, trigger: string, status: string, error: string | null = null) =>
            db.query('insert into sheet_sync_runs (organization_id,client_id,sheet_id,trigger,status,error) values ($1,$2,$3,$4,$5,$6)',
                [organizationId, client, 'sheet', trigger, status, error]);
        await assert.rejects(insert(org, 'invalid', 'failed'), { code: '23514' });
        await assert.rejects(insert(org, 'cron', 'invalid'), { code: '23514' });
        await assert.rejects(insert(org, 'cron', 'failed', 'x'.repeat(1001)), { code: '23514' });
        await assert.rejects(insert(next, 'cron', 'failed'), { code: '23503' });
        await insert(otherOrg, 'cron', 'skipped');

        await db.exec('set role authenticated');
        assert.equal((await db.query('select id from sheet_sync_runs')).rows.length, 2);
        await assert.rejects(insert(org, 'cron', 'failed'), { code: '42501' });
        await assert.rejects(db.exec('delete from sheet_sync_runs'), { code: '42501' });
        await assert.rejects(reserve(run, 'manual'), { code: '42501' });
        await db.exec('reset role; set role anon');
        await assert.rejects(db.query('select id from sheet_sync_runs'), { code: '42501' });
    } finally {
        await db.close();
    }
});

test('schema mirror contains the exact migration 135 section', () => {
    const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    const marker = '-- Migration 135: Sheet mirror sync runs.';
    assert.equal(schema.slice(schema.lastIndexOf(marker)).trim(), migration.trim());
});

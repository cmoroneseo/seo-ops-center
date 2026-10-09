import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/078_report_draft_uniqueness.sql', import.meta.url), 'utf8');

async function reportsTable() {
    const db = new PGlite();
    await db.exec(`
        create table public.reports (
            id uuid primary key,
            organization_id uuid,
            client_id uuid,
            report_month text not null,
            title text not null,
            status text not null default 'draft',
            created_at timestamptz not null default now()
        );
    `);
    return db;
}

test('custom reports can share a month and a second monthly draft cannot', async () => {
    const db = await reportsTable();
    await db.exec(`
        insert into public.reports (id, client_id, report_month, title) values
            ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '2026-09', 'One'),
            ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '2026-09', 'Two');
    `);
    await db.exec(migration);
    const kinds = await db.query<{ kind: string }>('select kind from public.reports order by title');
    assert.deepEqual(kinds.rows.map(row => row.kind), ['custom', 'custom']);
    const index = await db.query<{ indexname: string }>(`
        select indexname from pg_indexes
        where indexname = 'reports_client_month_monthly_key'
    `);
    assert.equal(index.rows.length, 1);
    await db.exec(`
        insert into public.reports (id, client_id, report_month, title, kind) values
            ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '2026-09', 'Monthly', 'monthly');
    `);
    await assert.rejects(
        db.exec(`
            insert into public.reports (id, client_id, report_month, title, kind) values
                ('10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '2026-09', 'Monthly again', 'monthly');
        `),
        /duplicate|unique/i,
    );
    await db.exec(`
        insert into public.reports (id, client_id, report_month, title) values
            ('10000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', '2026-09', 'Third custom');
    `);
    const count = await db.query<{ n: number }>('select count(*)::int as n from public.reports');
    assert.equal(count.rows[0].n, 4);
});

test('existing monthly duplicates abort the migration and are not deleted', async () => {
    const db = await reportsTable();
    await db.exec('alter table public.reports add column kind text');
    await db.exec(`
        insert into public.reports (id, client_id, report_month, title, kind) values
            ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000002', '2026-09', 'A', 'monthly'),
            ('10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000002', '2026-09', 'B', 'monthly');
    `);
    await assert.rejects(db.exec(migration), /duplicate monthly/i);
    const remaining = await db.query<{ n: number }>('select count(*)::int as n from public.reports');
    assert.equal(remaining.rows[0].n, 2);
    const index = await db.query<{ indexname: string }>(`
        select indexname from pg_indexes where indexname = 'reports_client_month_monthly_key'
    `);
    assert.equal(index.rows.length, 0);
});

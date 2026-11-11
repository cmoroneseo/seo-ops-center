/**
 * Run with: node --import tsx --test lib/reports/public-link-kind.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/127_report_public_link_kind.sql', import.meta.url), 'utf8');

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const REPORT = '66666666-6666-4666-8666-666666666666';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);

async function database() {
    const db = new PGlite();
    await db.exec(`
        create table public.report_public_links (
            id uuid primary key default gen_random_uuid(),
            organization_id uuid not null,
            client_id uuid not null,
            report_id uuid not null,
            version_id uuid,
            token_hash text not null check (length(token_hash) = 64),
            snapshot jsonb not null,
            expires_at timestamptz,
            revoked_at timestamptz,
            created_by uuid,
            created_at timestamptz not null default now(),
            constraint report_public_links_token_unique unique (token_hash),
            constraint report_public_links_snapshot_object check (
                jsonb_typeof(snapshot) = 'object'
                and pg_column_size(snapshot) <= 524288
            )
        );
        insert into public.report_public_links (organization_id, client_id, report_id, token_hash, snapshot)
        values ('${ORG}', '${CLIENT}', '${REPORT}', '${HASH_A}', '{"clientName":"Northwind"}'::jsonb);
        alter table public.report_public_links enable row level security;
        create policy report_public_links_org on public.report_public_links for select using (true);
    `);
    await db.exec(migration);
    return db;
}

async function rejected(db: PGlite, sql: string): Promise<boolean> {
    try {
        await db.exec(sql);
        return false;
    } catch {
        return true;
    }
}

test('existing links stay event links, and a roadmap link cannot store a snapshot', async () => {
    const db = await database();
    const existing = await db.query<{ kind: string; snapshot: unknown }>(
        'select kind, snapshot from public.report_public_links',
    );
    assert.equal(existing.rows.length, 1);
    assert.equal(existing.rows[0]?.kind, 'events');
    assert.equal((existing.rows[0]?.snapshot as { clientName?: string }).clientName, 'Northwind');

    await db.exec(`
        insert into public.report_public_links (organization_id, client_id, report_id, token_hash, kind, snapshot)
        values ('${ORG}', '${CLIENT}', '${REPORT}', '${HASH_B}', 'roadmap', null)
    `);
    const roadmap = await db.query<{ kind: string; snapshot: unknown }>(
        `select kind, snapshot from public.report_public_links where token_hash = '${HASH_B}'`,
    );
    assert.equal(roadmap.rows[0]?.kind, 'roadmap');
    assert.equal(roadmap.rows[0]?.snapshot, null);

    await db.exec(`
        insert into public.report_public_links (organization_id, client_id, report_id, token_hash, snapshot)
        values ('${ORG}', '${CLIENT}', '${REPORT}', '${HASH_C}', '{"ok":true}'::jsonb)
    `);
    const implied = await db.query<{ kind: string }>(
        `select kind from public.report_public_links where token_hash = '${HASH_C}'`,
    );
    assert.equal(implied.rows[0]?.kind, 'events');

    assert.equal(await rejected(db, `
        insert into public.report_public_links (organization_id, client_id, report_id, token_hash, kind, snapshot)
        values ('${ORG}', '${CLIENT}', '${REPORT}', '${HASH_D}', 'roadmap', '{"plan":true}'::jsonb)
    `), true);
    assert.equal(await rejected(db, `
        insert into public.report_public_links (organization_id, client_id, report_id, token_hash, kind, snapshot)
        values ('${ORG}', '${CLIENT}', '${REPORT}', '${HASH_D}', 'events', null)
    `), true);
    assert.equal(await rejected(db, `
        insert into public.report_public_links (organization_id, client_id, report_id, token_hash, kind, snapshot)
        values ('${ORG}', '${CLIENT}', '${REPORT}', '${HASH_D}', 'plan', null)
    `), true);

    const policies = await db.query<{ polname: string }>('select polname from pg_policy order by polname');
    assert.deepEqual(policies.rows.map(row => row.polname), ['report_public_links_org']);
    const indexes = await db.query<{ indexname: string }>(
        `select indexname from pg_indexes where tablename = 'report_public_links'`,
    );
    assert.equal(indexes.rows.some(row => row.indexname === 'report_public_links_report_kind_idx'), true);
});

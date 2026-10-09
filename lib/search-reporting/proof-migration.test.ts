import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/076_deliverable_proof.sql', import.meta.url), 'utf8');
const org = '11111111-1111-4111-8111-111111111111';
const client = '33333333-3333-4333-8333-333333333333';
const historical = '44444444-4444-4444-8444-444444444444';
const pending = '55555555-5555-4555-8555-555555555555';

async function database() {
    const db = new PGlite();
    await db.exec(`
        create table clients (
            id uuid primary key,
            domain text
        );
        create table deliverables (
            id uuid primary key,
            organization_id uuid not null,
            client_id uuid not null,
            title text not null,
            status text not null default 'Pending',
            published_url text,
            delivered_on timestamptz,
            notes text
        );
        insert into clients values ('${client}', 'https://www.Example.com/services');
        insert into deliverables (id, organization_id, client_id, title, status, published_url, delivered_on)
        values ('${historical}', '${org}', '${client}', 'Old page', 'Published', null, '2026-01-15');
    `);
    await db.exec(migration);
    await db.exec(`
        insert into deliverables (id, organization_id, client_id, title, status)
        values ('${pending}', '${org}', '${client}', 'Draft page', 'Pending');
    `);
    return db;
}

test('published proof is required only on the transition, and historical rows stay editable', async () => {
    const db = await database();
    try {
        await db.exec(`update deliverables set notes = 'still editable', title = 'Old page renamed' where id = '${historical}'`);
        await db.exec(`update deliverables set published_url = null where id = '${historical}'`);
        const historicalRow = (await db.query<{ title: string; published_url: string | null }>(
            `select title, published_url from deliverables where id = '${historical}'`,
        )).rows[0];
        assert.equal(historicalRow.title, 'Old page renamed');
        assert.equal(historicalRow.published_url, null);

        await assert.rejects(
            db.exec(`update deliverables set status = 'Published' where id = '${pending}'`),
            /Add the live page URL/,
        );
        await assert.rejects(
            db.exec(`update deliverables set status = 'Published', published_url = 'https://example.com/a' where id = '${pending}'`),
            /Add the ship date/,
        );
        await assert.rejects(
            db.exec(`update deliverables set status = 'Published', published_url = 'javascript:alert(1)', delivered_on = '2026-08-06' where id = '${pending}'`),
            /http:\/\/ or https:\/\//,
        );
        await assert.rejects(
            db.exec(`update deliverables set status = 'Published', published_url = 'https://evil.example/a', delivered_on = '2026-08-06' where id = '${pending}'`),
            /client domain/,
        );
        await assert.rejects(
            db.exec(`insert into deliverables (id, organization_id, client_id, title, status)
                values ('66666666-6666-4666-8666-666666666666', '${org}', '${client}', 'Inserted shipped', 'Published')`),
            /Add the live page URL/,
        );

        await db.exec(`update deliverables
            set status = 'Published', published_url = 'https://blog.example.com/chino/', delivered_on = '2026-08-06'
            where id = '${pending}'`);
        await db.exec(`update deliverables
            set status = 'Review' where id = '${pending}'`);
        await assert.rejects(
            db.exec(`update deliverables set status = 'Published', published_url = null where id = '${pending}'`),
            /Add the live page URL/,
        );
        await db.exec(`update deliverables
            set status = 'Published', published_url = 'https://maps.google.com/maps/place/scott', delivered_on = '2026-08-06'
            where id = '${pending}'`);
        await db.exec(`update deliverables
            set status = 'Approved' where id = '${pending}'`);
        await db.exec(`update deliverables
            set status = 'Published', published_url = 'https://www.yelp.com/biz/scott-cole', delivered_on = '2026-08-06'
            where id = '${pending}'`);

        const shipped = (await db.query<{ status: string; published_url: string }>(
            `select status, published_url from deliverables where id = '${pending}'`,
        )).rows[0];
        assert.equal(shipped.status, 'Published');
        assert.equal(shipped.published_url, 'https://www.yelp.com/biz/scott-cole');
    } finally {
        await db.close();
    }
});

test('schema.sql mirrors the deliverable proof migration', () => {
    const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    assert.equal(schema.includes(migration), true);
});

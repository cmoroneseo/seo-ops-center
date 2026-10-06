import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/069_client_portal_messages.sql', import.meta.url), 'utf8');
const client = '11111111-1111-4111-8111-111111111111';
const contact = '22222222-2222-4222-8222-222222222222';
const staff = '33333333-3333-4333-8333-333333333333';

test('messages migration preserves one author and rejects general threads for a different client', async () => {
    const db = new PGlite();
    try {
        await db.exec(`
            create table public.users (id uuid primary key);
            create table public.client_portal_feedback (
                id integer generated always as identity primary key,
                client_id uuid not null, subject_type text not null check (subject_type in ('plan', 'waiting_item')),
                subject_id uuid not null, contact_id uuid not null, body text not null
            );
            create table public.notifications (type text, entity_type text);
            insert into public.users values ('${staff}');
            insert into public.client_portal_feedback (client_id, subject_type, subject_id, contact_id, body)
                values ('${client}', 'plan', '${client}', '${contact}', 'Existing client note');
        `);
        await db.exec(migration);
        await db.query(`insert into client_portal_feedback (client_id,subject_type,subject_id,contact_id,body) values ($1,'general',$1,$2,'Client message')`, [client, contact]);
        await db.query(`insert into client_portal_feedback (client_id,subject_type,subject_id,staff_user_id,body) values ($1,'general',$1,$2,'Team reply')`, [client, staff]);
        await assert.rejects(db.query(`insert into client_portal_feedback (client_id,subject_type,subject_id,contact_id,body) values ($1,'general',$2,$2,'Wrong client')`, [client, contact]), /general_scope_check/);
        await assert.rejects(db.query(`insert into client_portal_feedback (client_id,subject_type,subject_id,body) values ($1,'general',$1,'Missing author')`, [client]), /author_check/);
        await assert.rejects(db.query(`insert into client_portal_feedback (client_id,subject_type,subject_id,contact_id,staff_user_id,body) values ($1,'general',$1,$2,$3,'Both authors')`, [client, contact, staff]), /author_check/);
        await db.query(`insert into notifications (type,entity_type) values ('portal_feedback','client_portal_feedback')`);
        const result = await db.query<{ count: number }>('select count(*)::int as count from client_portal_feedback');
        assert.equal(result.rows[0].count, 3);
    } finally { await db.close(); }
});

test('schema mirrors messaging migration without widening portal database privileges', () => {
    const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    assert.ok(schema.includes(migration));
    assert.doesNotMatch(migration, /grant|create policy/i);
});

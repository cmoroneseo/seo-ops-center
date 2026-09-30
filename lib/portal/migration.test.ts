import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../migrations/060_client_portal.sql', import.meta.url), 'utf8');

test('portal invites never create an organization membership', () => {
    assert.match(sql, /consume_client_portal_invite/);
    assert.doesNotMatch(sql, /insert into public\.organization_members/i);
    assert.match(sql, /service role required/);
    assert.match(sql, /invitation\.email <> normalized_email/);
    assert.match(sql, /contact\.revoked_at is not null/);
    assert.match(sql, /revoke all on function public\.consume_client_portal_invite/);
});

test('portal tables are locked down and contacts are not staff-writable', () => {
    for (const table of [
        'client_portal_contacts',
        'client_portal_invites',
        'client_portal_plan_shares',
        'client_portal_plan_decisions',
        'client_portal_report_shares',
        'client_portal_waiting_items',
        'client_portal_feedback',
    ]) {
        assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
        assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
    }
    assert.match(sql, /grant select on table public\.client_portal_contacts to authenticated/);
    assert.doesNotMatch(sql, /grant insert on table public\.client_portal_contacts/i);
    assert.match(sql, /client_portal_contacts_self_select/);
    assert.match(sql, /user_id = auth\.uid\(\)/);
});

test('schema.sql mirrors the client portal migration', () => {
    const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    assert.match(schema, /create table public\.client_portal_contacts/);
    assert.match(schema, /consume_client_portal_invite/);
});

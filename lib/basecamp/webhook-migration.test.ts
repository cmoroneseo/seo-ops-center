import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migrationUrl = new URL('../../migrations/037_basecamp_webhook_deliveries.sql', import.meta.url);
const schemaUrl = new URL('../../schema.sql', import.meta.url);

test('webhook receipt migration is additive, private, and mirrored', () => {
    assert.ok(existsSync(migrationUrl), 'missing Basecamp webhook receipt migration');
    const migration = readFileSync(migrationUrl, 'utf8');
    const schema = readFileSync(schemaUrl, 'utf8');

    for (const sql of [migration, schema]) {
        assert.match(sql, /create table if not exists public\.basecamp_webhook_deliveries/i);
        assert.match(sql, /event_id bigint primary key/i);
        assert.match(sql, /request_id uuid not null unique/i);
        assert.match(sql, /enable row level security/i);
        assert.match(sql, /revoke all on table public\.basecamp_webhook_deliveries\s+from public, anon, authenticated/i);
        assert.match(sql, /grant select, insert, update on table public\.basecamp_webhook_deliveries\s+to service_role/i);
    }
    assert.doesNotMatch(migration, /drop table|drop column/i);
});

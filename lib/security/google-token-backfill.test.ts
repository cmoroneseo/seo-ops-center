import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { executeGoogleTokenBackfill, type IntegrationSecretRow } from './google-token-backfill';
import { credentialSecretState, openCredentialSecrets, parseKeyRing, sealCredentialSecrets } from './google-token-crypto';

function ring() {
    return parseKeyRing(randomBytes(32).toString('base64url'));
}

function row(credentials: unknown, id = 'row-1'): IntegrationSecretRow {
    return { id, organizationId: 'org', clientId: 'client', service: 'ga4', credentials };
}

test('dry-run counts plaintext and writes nothing', async () => {
    const writes: unknown[] = [];
    const report = await executeGoogleTokenBackfill({
        rows: [row({ access_token: 'access-secret', refresh_token: 'refresh-secret', property_id: 'properties/1' })],
        ring: ring(),
        dryRun: true,
        verify: true,
        write: async (_row, next) => {
            writes.push(next);
            return 'updated';
        },
    });
    assert.equal(report.plaintext, 1);
    assert.equal(report.updated, 0);
    assert.deepEqual(writes, []);
    assert.equal(JSON.stringify(report).includes('access-secret'), false);
});

test('commit seals plaintext, verify round-trips, and a second run is a no-op', async () => {
    const keys = ring();
    const original = { access_token: 'access-secret', refresh_token: 'refresh-secret', site_url: 'sc-domain:example.com' };
    let stored: unknown = original;
    const write = async (current: IntegrationSecretRow, next: Record<string, unknown>) => {
        if (JSON.stringify(current.credentials) !== JSON.stringify(stored)) return 'conflict' as const;
        stored = next;
        return 'updated' as const;
    };
    const first = await executeGoogleTokenBackfill({
        rows: [row(stored)],
        ring: keys,
        dryRun: false,
        verify: true,
        write,
        reread: async () => stored,
    });
    assert.equal(first.updated, 1);
    assert.equal(first.failed, 0);
    assert.equal(credentialSecretState(stored, keys), 'sealed');
    assert.equal(openCredentialSecrets(stored, keys).access_token, 'access-secret');
    assert.equal((stored as { site_url: string }).site_url, 'sc-domain:example.com');
    const second = await executeGoogleTokenBackfill({
        rows: [row(stored)],
        ring: keys,
        dryRun: false,
        verify: true,
        write,
        reread: async () => stored,
    });
    assert.equal(second.updated, 0);
    assert.equal(second.unchanged, 1);
});

test('a missing key does not claim plaintext rows are sealed', async () => {
    const report = await executeGoogleTokenBackfill({
        rows: [row({ refresh_token: 'refresh-secret' })],
        ring: null,
        dryRun: false,
        verify: false,
        write: async () => 'updated',
    });
    assert.equal(report.failed, 1);
    assert.equal(report.failures[0]?.code, 'key_missing');
    assert.equal(report.updated, 0);
});

test('verify fails when the reread token does not match', async () => {
    const keys = ring();
    const report = await executeGoogleTokenBackfill({
        rows: [row({ access_token: 'access-secret' })],
        ring: keys,
        dryRun: false,
        verify: true,
        write: async () => 'updated',
        reread: async () => sealCredentialSecrets({ access_token: 'different' }, keys),
    });
    assert.equal(report.failed, 1);
    assert.equal(report.failures[0]?.code, 'verify_failed');
});

test('an already sealed row with the current kid is unchanged', async () => {
    const keys = ring();
    const sealed = sealCredentialSecrets({ access_token: 'access-secret', refresh_token: 'refresh-secret' }, keys);
    let writes = 0;
    const report = await executeGoogleTokenBackfill({
        rows: [row(sealed)],
        ring: keys,
        dryRun: false,
        verify: true,
        write: async () => {
            writes += 1;
            return 'updated';
        },
    });
    assert.equal(writes, 0);
    assert.equal(report.unchanged, 1);
});

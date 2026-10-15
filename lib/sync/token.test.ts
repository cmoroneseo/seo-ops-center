import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { isTokenEnvelope, openCredentialSecrets, parseKeyRing, sealCredentialSecrets } from '@/lib/security/google-token-crypto';
import { getGoogleAccessToken, GoogleAuthError, type TokenDeps } from './token';

type Row = { credentials: Record<string, unknown>; sync_status: string } | null;

function harness(row: Row, options?: { failUpdate?: boolean; reread?: Row }) {
    const marked: string[] = [];
    const statuses: string[][] = [];
    const filters: string[] = [];
    const updates: Record<string, unknown>[] = [];
    const bodies: string[] = [];
    let reads = 0;
    const admin = () => ({
        from() {
            let mode: 'select' | 'update' = 'select';
            const query = {
                select() { return query; },
                eq() { return query; },
                in(_column: string, values: readonly string[]) {
                    statuses.push([...values]);
                    return query;
                },
                filter(_column: string, operator: string, value: string) {
                    filters.push(`${operator}:${value}`);
                    return query;
                },
                update(values: Record<string, unknown>) {
                    updates.push(values);
                    mode = 'update';
                    return query;
                },
                maybeSingle: async () => {
                    if (mode === 'update') return { data: options?.failUpdate ? null : { id: 'row' }, error: null };
                    reads += 1;
                    if (reads > 1) return { data: options?.reread ?? null, error: null };
                    if (row && statuses.at(-1) && !statuses.at(-1)!.includes(row.sync_status)) return { data: null, error: null };
                    return { data: row, error: null };
                },
            };
            return query;
        },
    });
    const deps: TokenDeps = {
        admin,
        fetch: async (_url, init) => {
            bodies.push(String(init?.body ?? ''));
            return Response.json({ access_token: 'fresh-token', expires_in: 120 });
        },
        now: () => 1_700_000_000_000,
        markError: async (_clientId: string, _service: string, message: string) => { marked.push(message); },
    };
    return { marked, statuses, filters, updates, bodies, deps };
}

function testRing() {
    return parseKeyRing(randomBytes(32).toString('base64url'));
}

test('an errored GA4 row with a refresh token returns a new token', async () => {
    const { deps, statuses, filters, marked } = harness({
        sync_status: 'error',
        credentials: { refresh_token: 'refresh', access_token: 'old', expiry_date: 1 },
    });
    const result = await getGoogleAccessToken('client', 'ga4', deps);
    assert.deepEqual(statuses[0], ['active', 'error']);
    assert.equal(result?.token, 'fresh-token');
    assert.equal(result?.creds.expiry_date, 1_700_000_000_000 + 120_000);
    assert.match(filters[0], /"refresh_token":"refresh"/);
    assert.deepEqual(marked, []);
});

test('pending setup is not eligible for a token', async () => {
    const { deps } = harness({ sync_status: 'pending_setup', credentials: { refresh_token: 'refresh' } });
    assert.equal(await getGoogleAccessToken('client', 'gbp', deps), null);
});

test('invalid_grant marks the integration and requires reconnect', async () => {
    const { deps, marked } = harness({ sync_status: 'active', credentials: { refresh_token: 'refresh' } });
    deps.fetch = async () => Response.json({ error: 'invalid_grant' }, { status: 400 });
    await assert.rejects(
        () => getGoogleAccessToken('client', 'ga4', deps),
        (error: unknown) => error instanceof GoogleAuthError && error.kind === 'reauth_required',
    );
    assert.deepEqual(marked, ['Google authorization expired. Reconnect this integration.']);
});

test('a transient refresh failure does not mark the integration', async () => {
    const { deps, marked } = harness({ sync_status: 'error', credentials: { refresh_token: 'refresh' } });
    deps.fetch = async () => new Response('upstream', { status: 503 });
    await assert.rejects(
        () => getGoogleAccessToken('client', 'gbp', deps),
        (error: unknown) => error instanceof GoogleAuthError && error.kind === 'transient' && !error.message.includes('upstream'),
    );
    assert.deepEqual(marked, []);
});

test('a lost credential update re-reads a token another writer stored', async () => {
    const { deps, marked } = harness(
        { sync_status: 'active', credentials: { refresh_token: 'refresh', access_token: 'old', expiry_date: 1 } },
        {
            failUpdate: true,
            reread: { sync_status: 'active', credentials: { access_token: 'other-writer', expiry_date: 1_700_000_000_000 + 60_000 } },
        },
    );
    const result = await getGoogleAccessToken('client', 'ga4', deps);
    assert.equal(result?.token, 'other-writer');
    assert.deepEqual(marked, []);
});

test('a legacy plaintext access token is reused without a refresh', async () => {
    const { deps, bodies } = harness({
        sync_status: 'active',
        credentials: { access_token: 'still-good', refresh_token: 'refresh', expiry_date: 1_700_000_000_000 + 120_000, property_id: 'properties/9' },
    });
    deps.keyRing = null;
    const result = await getGoogleAccessToken('client', 'ga4', deps);
    assert.equal(result?.token, 'still-good');
    assert.equal(result?.creds.property_id, 'properties/9');
    assert.deepEqual(bodies, []);
});

test('refresh seals the new access token and compares the stored plaintext', async () => {
    const ring = testRing();
    const { deps, filters, updates, bodies } = harness({
        sync_status: 'active',
        credentials: { refresh_token: 'refresh', access_token: 'old', expiry_date: 1, site_url: 'sc-domain:example.com' },
    });
    deps.keyRing = ring;
    const result = await getGoogleAccessToken('client', 'ga4', deps);
    assert.equal(result?.token, 'fresh-token');
    assert.equal(result?.creds.access_token, 'fresh-token');
    assert.equal(result?.creds.site_url, 'sc-domain:example.com');
    assert.match(filters[0], /"refresh_token":"refresh"/);
    assert.match(bodies[0], /refresh_token=refresh/);
    assert.equal(bodies[0].includes('aes-256-gcm'), false);
    const stored = updates[0].credentials as Record<string, unknown>;
    assert.equal(isTokenEnvelope(stored.access_token), true);
    assert.equal(isTokenEnvelope(stored.refresh_token), true);
    assert.equal(openCredentialSecrets(stored, ring).access_token, 'fresh-token');
    assert.equal(stored.site_url, 'sc-domain:example.com');
});

test('a sealed access token is decrypted and reused', async () => {
    const ring = testRing();
    const credentials = sealCredentialSecrets({
        access_token: 'cached-token',
        refresh_token: 'refresh',
        expiry_date: 1_700_000_000_000 + 120_000,
    }, ring);
    const { deps, bodies } = harness({ sync_status: 'error', credentials });
    deps.keyRing = ring;
    const result = await getGoogleAccessToken('client', 'ga4', deps);
    assert.equal(result?.token, 'cached-token');
    assert.deepEqual(bodies, []);
});

test('refresh of a sealed row sends the plaintext refresh token and swaps on the ciphertext', async () => {
    const ring = testRing();
    const credentials = sealCredentialSecrets({ refresh_token: 'refresh', access_token: 'old', expiry_date: 1 }, ring);
    const { deps, filters, bodies, updates } = harness({ sync_status: 'active', credentials });
    deps.keyRing = ring;
    const result = await getGoogleAccessToken('client', 'gsc', deps);
    assert.equal(result?.token, 'fresh-token');
    assert.match(bodies[0], /refresh_token=refresh/);
    assert.match(filters[0], /"enc":"aes-256-gcm"/);
    assert.equal(isTokenEnvelope((updates[0].credentials as Record<string, unknown>).access_token), true);
});

test('a lost update accepts a sealed token another writer stored', async () => {
    const ring = testRing();
    const { deps } = harness(
        { sync_status: 'active', credentials: { refresh_token: 'refresh', access_token: 'old', expiry_date: 1 } },
        {
            failUpdate: true,
            reread: {
                sync_status: 'active',
                credentials: sealCredentialSecrets({
                    access_token: 'other-writer',
                    expiry_date: 1_700_000_000_000 + 120_000,
                }, ring),
            },
        },
    );
    deps.keyRing = ring;
    const result = await getGoogleAccessToken('client', 'ga4', deps);
    assert.equal(result?.token, 'other-writer');
});

test('an unreadable envelope is a transient failure and does not mark reauth', async () => {
    const { deps, marked } = harness({
        sync_status: 'active',
        credentials: {
            access_token: { enc: 'aes-256-gcm', v: 1, kid: 'missing', iv: 'aa', tag: 'bb', ct: 'cc' },
            refresh_token: 'refresh',
        },
    });
    deps.keyRing = testRing();
    await assert.rejects(
        () => getGoogleAccessToken('client', 'ga4', deps),
        (error: unknown) => error instanceof GoogleAuthError && error.kind === 'transient',
    );
    assert.deepEqual(marked, []);
});

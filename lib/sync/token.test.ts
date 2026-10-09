import test from 'node:test';
import assert from 'node:assert/strict';
import { getGoogleAccessToken, GoogleAuthError } from './token';

type Row = { credentials: Record<string, unknown>; sync_status: string } | null;

function harness(row: Row, options?: { failUpdate?: boolean; reread?: Row }) {
    const marked: string[] = [];
    const statuses: string[][] = [];
    const filters: string[] = [];
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
                update() { mode = 'update'; return query; },
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
    return {
        marked,
        statuses,
        filters,
        deps: {
            admin,
            fetch: async () => Response.json({ access_token: 'fresh-token', expires_in: 120 }),
            now: () => 1_700_000_000_000,
            markError: async (_clientId: string, _service: string, message: string) => { marked.push(message); },
        },
    };
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

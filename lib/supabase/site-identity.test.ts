import assert from 'node:assert/strict';
import test from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
    getSiteIdentityReview,
    setSiteIdentityDecision,
    SiteIdentityError,
} from './site-identity.ts';

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: unknown };

const SCOPED_TABLES = new Set([
    'site_pages',
    'site_page_urls',
    'site_crawl_runs',
    'site_page_snapshots',
    'site_page_claims',
    'site_page_identity_decisions',
]);

class FakeQuery implements PromiseLike<QueryResult> {
    private filters: Array<[string, unknown]> = [];
    private orders: Array<[string, boolean]> = [];
    private rowLimit?: number;
    private rowRange?: [number, number];
    private cardinality: 'many' | 'maybeSingle' | 'single' = 'many';

    constructor(private client: FakeClient, private table: string) {}

    select() { return this; }

    eq(column: string, value: unknown) {
        this.filters.push([column, value]);
        return this;
    }

    order(column: string, options: { ascending: boolean }) {
        this.orders.push([column, options.ascending]);
        return this;
    }

    limit(value: number) {
        this.rowLimit = value;
        return this;
    }

    range(from: number, to: number) {
        this.rowRange = [from, to];
        return this;
    }

    maybeSingle() {
        this.cardinality = 'maybeSingle';
        return this.execute();
    }

    single() {
        this.cardinality = 'single';
        return this.execute();
    }

    then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
        return this.execute().then(onfulfilled, onrejected);
    }

    private async execute(): Promise<QueryResult> {
        if (SCOPED_TABLES.has(this.table)) {
            assert.ok(this.filters.some(([column]) => column === 'organization_id'), `${this.table} omitted organization_id scope`);
            assert.ok(this.filters.some(([column]) => column === 'client_id'), `${this.table} omitted client_id scope`);
        }
        this.client.queryCalls.push({
            table: this.table,
            filters: [...this.filters],
            orders: [...this.orders],
            range: this.rowRange,
        });
        const error = this.client.tableErrors[this.table];
        if (error) return { data: null, error };

        let rows = [...(this.client.tables[this.table] ?? [])]
            .filter(row => this.filters.every(([column, value]) => row[column] === value));
        if (this.orders.length > 0) {
            rows.sort((left, right) => {
                for (const [column, ascending] of this.orders) {
                    const comparison = String(left[column]).localeCompare(String(right[column]));
                    if (comparison !== 0) return ascending ? comparison : -comparison;
                }
                return 0;
            });
        }
        if (this.rowRange) {
            const from = this.rowRange[0] > 0 && this.client.repeatBoundaryTables.has(this.table)
                ? this.rowRange[0] - 1
                : this.rowRange[0];
            rows = rows.slice(from, this.rowRange[1] + 1);
        }
        if (this.rowLimit !== undefined) rows = rows.slice(0, this.rowLimit);
        if (this.client.serverResponseCap !== undefined) rows = rows.slice(0, this.client.serverResponseCap);
        if (this.cardinality === 'maybeSingle') {
            return { data: rows[0] ?? null, error: null };
        }
        if (this.cardinality === 'single') {
            return rows.length === 1
                ? { data: rows[0], error: null }
                : { data: null, error: { message: 'Expected one row' } };
        }
        return { data: rows, error: null };
    }
}

class FakeClient {
    queryCalls: Array<{
        table: string;
        filters: Array<[string, unknown]>;
        orders: Array<[string, boolean]>;
        range?: [number, number];
    }> = [];
    rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    tableErrors: Record<string, unknown> = {};
    rpcResult: QueryResult = { data: null, error: null };
    rpcThrown?: unknown;
    serverResponseCap?: number;
    repeatBoundaryTables = new Set<string>();

    constructor(public tables: Record<string, Row[]>) {}

    from(table: string) {
        return new FakeQuery(this, table);
    }

    async rpc(name: string, args: Record<string, unknown>) {
        this.rpcCalls.push({ name, args });
        if (this.rpcThrown) throw this.rpcThrown;
        return this.rpcResult;
    }
}

function row(overrides: Row): Row {
    return { organization_id: 'org-a', client_id: 'client-a', ...overrides };
}

function fixture() {
    return new FakeClient({
        site_crawl_runs: [
            row({ id: 'run-old', status: 'completed', created_at: '2026-09-01T00:00:00Z' }),
            row({ id: 'run-z', status: 'completed', created_at: '2026-09-10T00:00:00Z' }),
            row({ id: 'run-a', status: 'completed', created_at: '2026-09-10T00:00:00Z' }),
            row({ id: 'run-live', status: 'running', created_at: '2026-09-11T00:00:00Z' }),
        ],
        site_pages: [
            row({ id: 'page-source' }),
            row({ id: 'page-target' }),
            { id: 'page-foreign', organization_id: 'org-b', client_id: 'client-b' },
        ],
        site_page_urls: [
            row({ id: 'url-source', site_page_id: 'page-source', normalized_url: 'https://example.com/source', is_primary: true, discovery_sources: ['sitemap'] }),
            row({ id: 'url-target', site_page_id: 'page-target', normalized_url: 'https://example.com/target', is_primary: true, discovery_sources: ['redirect'] }),
            row({ id: 'url-target-alias', site_page_id: 'page-target', normalized_url: 'https://example.com/target-alias', is_primary: false, discovery_sources: ['internal'] }),
            { id: 'url-foreign', site_page_id: 'page-foreign', normalized_url: 'https://foreign.example/page', is_primary: true, discovery_sources: ['seed'], organization_id: 'org-b', client_id: 'client-b' },
        ],
        site_page_snapshots: [
            row({
                id: 'snapshot-source-old', run_id: 'run-z', site_page_id: 'page-source', site_page_url_id: 'url-source',
                observed_at: '2026-09-10T10:00:00Z', fetch_status: 'success', status_code: 200,
                redirect_hops: [], canonical_url: null, canonical_issue: 'none', title: 'Old source', limitation_flags: [],
            }),
            row({
                id: 'snapshot-source', run_id: 'run-z', site_page_id: 'page-source', site_page_url_id: 'url-source',
                observed_at: '2026-09-10T12:00:00Z', fetch_status: 'success', status_code: 301,
                redirect_hops: ['HTTPS://EXAMPLE.COM:443/target#redirect'], canonical_url: 'https://example.com/unseen#canonical',
                canonical_issue: 'target_redirect', title: 'Source title', limitation_flags: ['redirected'],
            }),
            row({
                id: 'snapshot-target', run_id: 'run-z', site_page_id: 'page-target', site_page_url_id: 'url-target',
                observed_at: '2026-09-10T11:00:00Z', fetch_status: 'success', status_code: 200,
                redirect_hops: [], canonical_url: 'https://example.com/target', canonical_issue: 'none',
                title: 'Target title', limitation_flags: [],
            }),
            row({
                id: 'snapshot-wrong-run', run_id: 'run-old', site_page_id: 'page-source', site_page_url_id: 'url-source',
                observed_at: '2026-09-11T15:00:00Z', fetch_status: 'success', status_code: 200,
                redirect_hops: [], canonical_url: null, canonical_issue: 'none', title: 'Wrong run', limitation_flags: [],
            }),
        ],
        site_page_claims: [
            row({ source_site_page_id: 'page-source', target_site_page_id: 'page-target', decision_id: 'decision-active' }),
        ],
        site_page_identity_decisions: [
            row({
                id: 'decision-active', source_site_page_id: 'page-source', target_site_page_id: 'page-target',
                decision_kind: 'claim_into', reason_code: 'redirect_alias', note: null,
                created_by: 'user-a', created_at: '2026-09-10T13:00:00Z',
            }),
            row({
                id: 'decision-foreign-page', source_site_page_id: 'page-target', target_site_page_id: null,
                decision_kind: 'needs_research', reason_code: 'ownership_unknown', note: 'Target review',
                created_by: 'user-a', created_at: '2026-09-10T14:00:00Z',
            }),
        ],
    });
}

function asSupabase(fake: FakeClient) {
    return fake as unknown as SupabaseClient;
}

test('builds exact candidates from the latest completed run and maps current review state', async () => {
    const fake = fixture();

    const review = await getSiteIdentityReview(asSupabase(fake), 'org-a', 'client-a', 'page-source');

    assert.equal(review.source.snapshotId, 'snapshot-source');
    assert.equal(review.source.primaryUrl, 'https://example.com/source');
    assert.equal(review.candidates[0].page.pageId, 'page-target');
    assert.equal(review.candidates[0].page.primaryUrl, 'https://example.com/target');
    assert.deepEqual(review.candidates[0].signals, [{
        kind: 'redirect',
        url: 'https://example.com/target',
        matchedPageId: 'page-target',
    }]);
    assert.deepEqual(review.unmatchedSignals, [{ kind: 'canonical', url: 'https://example.com/unseen' }]);
    assert.deepEqual(review.activeClaim, {
        sourcePageId: 'page-source',
        targetPageId: 'page-target',
        decisionId: 'decision-active',
    });
    assert.deepEqual(review.resolution, {
        requestedPageId: 'page-source',
        resolvedPageId: 'page-target',
        path: ['page-source', 'page-target'],
        claimed: true,
    });
    assert.deepEqual(review.decisions, [{
        id: 'decision-active',
        sourcePageId: 'page-source',
        targetPageId: 'page-target',
        decisionKind: 'claim_into',
        reasonCode: 'redirect_alias',
        createdBy: 'user-a',
        createdAt: '2026-09-10T13:00:00Z',
    }]);
});

test('paginates the complete URL index and active claims under a capped server response', async () => {
    const fake = fixture();
    fake.serverResponseCap = 2;
    const sourceSnapshot = fake.tables.site_page_snapshots.find(snapshot => snapshot.id === 'snapshot-source');
    assert.ok(sourceSnapshot);
    sourceSnapshot.redirect_hops = ['https://example.com/target-alias'];
    sourceSnapshot.canonical_url = null;
    fake.tables.site_page_claims.push(
        row({ source_site_page_id: 'page-target', target_site_page_id: 'page-mid', decision_id: 'decision-mid' }),
        row({ source_site_page_id: 'page-mid', target_site_page_id: 'page-root', decision_id: 'decision-root' }),
    );

    const review = await getSiteIdentityReview(asSupabase(fake), 'org-a', 'client-a', 'page-source');

    assert.equal(review.candidates[0].page.pageId, 'page-target');
    assert.deepEqual(review.resolution, {
        requestedPageId: 'page-source',
        resolvedPageId: 'page-root',
        path: ['page-source', 'page-target', 'page-mid', 'page-root'],
        claimed: true,
    });
    for (const table of ['site_page_urls', 'site_page_claims']) {
        const calls = fake.queryCalls.filter(call => call.table === table);
        assert.ok(calls.length > 1, `${table} was not paginated`);
        assert.ok(calls.every(call => call.range !== undefined), `${table} omitted range pagination`);
        assert.deepEqual(calls[0].orders, [[table === 'site_page_urls' ? 'id' : 'source_site_page_id', true]]);
    }
});

test('rejects a malformed pagination key instead of accepting an incomplete URL index', async () => {
    const fake = fixture();
    fake.tables.site_page_urls[0].id = null;

    await assert.rejects(
        getSiteIdentityReview(asSupabase(fake), 'org-a', 'client-a', 'page-source'),
        (error: unknown) => error instanceof SiteIdentityError && error.code === 'read_failed',
    );
});

test('rejects a repeated pagination boundary instead of accumulating duplicate claims', async () => {
    const fake = fixture();
    fake.serverResponseCap = 2;
    fake.repeatBoundaryTables.add('site_page_claims');

    await assert.rejects(
        getSiteIdentityReview(asSupabase(fake), 'org-a', 'client-a', 'page-source'),
        (error: unknown) => error instanceof SiteIdentityError && error.code === 'read_failed',
    );
});

test('freezes claim evidence exclusively from scoped stored rows', async () => {
    const fake = fixture();
    fake.tables.site_page_claims = [];
    fake.rpcResult = {
        data: row({
            id: 'decision-new', source_site_page_id: 'page-source', target_site_page_id: 'page-target',
            decision_kind: 'claim_into', reason_code: 'redirect_alias', note: 'Reviewed',
            created_by: 'user-a', created_at: '2026-09-11T00:00:00Z',
        }),
        error: null,
    };

    const decision = await setSiteIdentityDecision(asSupabase(fake), {
        organizationId: 'org-a',
        clientId: 'client-a',
        createdBy: 'user-a',
        sourcePageId: 'page-source',
        targetPageId: 'page-target',
        decisionKind: 'claim_into',
        reasonCode: 'redirect_alias',
        note: 'Reviewed',
        expectedSourceSnapshotId: 'snapshot-source',
        expectedTargetSnapshotId: 'snapshot-target',
        evidenceSnapshot: { browserControlled: 'must-not-survive' },
    } as Parameters<typeof setSiteIdentityDecision>[1] & { evidenceSnapshot: unknown });

    assert.equal(decision.id, 'decision-new');
    assert.deepEqual(fake.rpcCalls, [{
        name: 'set_site_page_identity_decision',
        args: {
            p_organization_id: 'org-a',
            p_client_id: 'client-a',
            p_created_by: 'user-a',
            p_source_site_page_id: 'page-source',
            p_target_site_page_id: 'page-target',
            p_decision_kind: 'claim_into',
            p_reason_code: 'redirect_alias',
            p_note: 'Reviewed',
            p_evidence_snapshot: {
                version: 1,
                source: {
                    pageId: 'page-source',
                    primaryUrl: 'https://example.com/source',
                    snapshotId: 'snapshot-source',
                    observedAt: '2026-09-10T12:00:00Z',
                    title: 'Source title',
                    fetchStatus: 'success',
                    statusCode: 301,
                    canonicalUrl: 'https://example.com/unseen#canonical',
                    canonicalIssue: 'target_redirect',
                    redirectHops: ['HTTPS://EXAMPLE.COM:443/target#redirect'],
                    discoverySources: ['sitemap'],
                    limitationFlags: ['redirected'],
                },
                target: {
                    pageId: 'page-target',
                    primaryUrl: 'https://example.com/target',
                    snapshotId: 'snapshot-target',
                    observedAt: '2026-09-10T11:00:00Z',
                    title: 'Target title',
                    fetchStatus: 'success',
                    statusCode: 200,
                    canonicalUrl: 'https://example.com/target',
                    canonicalIssue: 'none',
                    redirectHops: [],
                    discoverySources: ['redirect'],
                    limitationFlags: [],
                },
                signals: [
                    { kind: 'redirect', url: 'https://example.com/target', matchedPageId: 'page-target' },
                    { kind: 'canonical', url: 'https://example.com/unseen' },
                ],
            },
        },
    }]);
});

test('rejects stale source or required target evidence before calling the RPC', async () => {
    const fake = fixture();
    fake.tables.site_page_claims = [];

    await assert.rejects(
        setSiteIdentityDecision(asSupabase(fake), {
            organizationId: 'org-a', clientId: 'client-a', createdBy: 'user-a',
            sourcePageId: 'page-source', targetPageId: 'page-target', decisionKind: 'claim_into',
            reasonCode: 'redirect_alias', expectedSourceSnapshotId: 'snapshot-source-old',
            expectedTargetSnapshotId: 'snapshot-target',
        }),
        (error: unknown) => error instanceof SiteIdentityError && error.code === 'stale',
    );
    await assert.rejects(
        setSiteIdentityDecision(asSupabase(fake), {
            organizationId: 'org-a', clientId: 'client-a', createdBy: 'user-a',
            sourcePageId: 'page-source', targetPageId: 'page-target', decisionKind: 'claim_into',
            reasonCode: 'redirect_alias', expectedSourceSnapshotId: 'snapshot-source',
        }),
        (error: unknown) => error instanceof SiteIdentityError && error.code === 'stale',
    );
    assert.equal(fake.rpcCalls.length, 0);
});

test('derives the active target for reopen while passing no nominated RPC target', async () => {
    const fake = fixture();
    fake.rpcResult = {
        data: row({
            id: 'decision-reopen', source_site_page_id: 'page-source', target_site_page_id: 'page-target',
            decision_kind: 'reopen', reason_code: 'new_evidence', note: null,
            created_by: 'user-a', created_at: '2026-09-11T00:00:00Z',
        }),
        error: null,
    };

    await setSiteIdentityDecision(asSupabase(fake), {
        organizationId: 'org-a', clientId: 'client-a', createdBy: 'user-a',
        sourcePageId: 'page-source', decisionKind: 'reopen', reasonCode: 'new_evidence',
        expectedSourceSnapshotId: 'snapshot-source',
    });

    const args = fake.rpcCalls[0].args;
    assert.equal(args.p_target_site_page_id, null);
    assert.deepEqual((args.p_evidence_snapshot as Row).target, {
        pageId: 'page-target',
        primaryUrl: 'https://example.com/target',
        snapshotId: 'snapshot-target',
        observedAt: '2026-09-10T11:00:00Z',
        title: 'Target title',
        fetchStatus: 'success',
        statusCode: 200,
        canonicalUrl: 'https://example.com/target',
        canonicalIssue: 'none',
        redirectHops: [],
        discoverySources: ['redirect'],
        limitationFlags: [],
    });
});

test('keeps targetless decisions targetless and freezes only source evidence', async () => {
    const fake = fixture();
    fake.tables.site_page_claims = [];
    fake.rpcResult = {
        data: row({
            id: 'decision-research', source_site_page_id: 'page-source', target_site_page_id: null,
            decision_kind: 'needs_research', reason_code: 'conflicting_signals', note: null,
            created_by: 'user-a', created_at: '2026-09-11T00:00:00Z',
        }),
        error: null,
    };

    await setSiteIdentityDecision(asSupabase(fake), {
        organizationId: 'org-a', clientId: 'client-a', createdBy: 'user-a',
        sourcePageId: 'page-source', decisionKind: 'needs_research', reasonCode: 'conflicting_signals',
        expectedSourceSnapshotId: 'snapshot-source',
    });

    const args = fake.rpcCalls[0].args;
    assert.equal(args.p_target_site_page_id, null);
    assert.equal('target' in (args.p_evidence_snapshot as Row), false);
});

test('translates raw read and persistence failures into stable safe application errors', async () => {
    const readFailure = fixture();
    readFailure.tableErrors.site_page_urls = { message: 'secret provider read detail' };
    await assert.rejects(
        getSiteIdentityReview(asSupabase(readFailure), 'org-a', 'client-a', 'page-source'),
        (error: unknown) => error instanceof SiteIdentityError
            && error.code === 'read_failed'
            && !error.message.includes('secret'),
    );

    const conflict = fixture();
    conflict.rpcResult = { data: null, error: { message: 'Source already has an active claim: secret detail' } };
    await assert.rejects(
        setSiteIdentityDecision(asSupabase(conflict), {
            organizationId: 'org-a', clientId: 'client-a', createdBy: 'user-a',
            sourcePageId: 'page-source', decisionKind: 'reopen', reasonCode: 'new_evidence',
            expectedSourceSnapshotId: 'snapshot-source',
        }),
        (error: unknown) => error instanceof SiteIdentityError
            && error.code === 'conflict'
            && !error.message.includes('secret'),
    );

    const rejectedRpc = fixture();
    rejectedRpc.rpcThrown = new Error('secret network rejection');
    await assert.rejects(
        setSiteIdentityDecision(asSupabase(rejectedRpc), {
            organizationId: 'org-a', clientId: 'client-a', createdBy: 'user-a',
            sourcePageId: 'page-source', decisionKind: 'reopen', reasonCode: 'new_evidence',
            expectedSourceSnapshotId: 'snapshot-source',
        }),
        (error: unknown) => error instanceof SiteIdentityError
            && error.code === 'write_failed'
            && !error.message.includes('secret'),
    );

    const malformedStoredSignal = fixture();
    const currentSource = malformedStoredSignal.tables.site_page_snapshots
        .find(snapshot => snapshot.id === 'snapshot-source');
    assert.ok(currentSource);
    currentSource.canonical_url = 'not an absolute URL';
    await assert.rejects(
        setSiteIdentityDecision(asSupabase(malformedStoredSignal), {
            organizationId: 'org-a', clientId: 'client-a', createdBy: 'user-a',
            sourcePageId: 'page-source', decisionKind: 'reopen', reasonCode: 'new_evidence',
            expectedSourceSnapshotId: 'snapshot-source',
        }),
        (error: unknown) => error instanceof SiteIdentityError
            && error.code === 'write_failed'
            && !error.message.includes('URL'),
    );
});

test('returns a stable not-found error for a page outside the scoped client', async () => {
    await assert.rejects(
        getSiteIdentityReview(asSupabase(fixture()), 'org-a', 'client-a', 'page-foreign'),
        (error: unknown) => error instanceof SiteIdentityError && error.code === 'not_found',
    );
});

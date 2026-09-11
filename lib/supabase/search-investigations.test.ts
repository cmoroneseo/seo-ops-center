import assert from 'node:assert/strict';
import test from 'node:test';

import type { SearchInvestigationEvidenceSnapshot } from '../types';
import {
    getSearchInvestigations,
    rowToSearchInvestigation,
    setSearchInvestigationDecision,
} from './search-investigations.ts';

const snapshot: SearchInvestigationEvidenceSnapshot = {
    version: 1,
    category: 'deeper_visibility',
    property: 'sc-domain:ecoworkz.net',
    start: '2026-09-01',
    end: '2026-09-07',
    query: 'hardscape contractor',
    page: 'https://www.ecoworkz.net/corona-ca/',
    clicks: 0,
    impressions: 237,
    ctr: 0,
    position: 33,
    observedDays: 7,
    limitations: ['Observed visibility is not proof of a ranking opportunity.'],
};

const row = {
    id: 'inv-1',
    organization_id: 'org-1',
    client_id: 'client-1',
    property: 'sc-domain:ecoworkz.net',
    kind: 'query_page',
    identity_key: 'hash',
    query: 'hardscape contractor',
    page: 'https://www.ecoworkz.net/corona-ca/',
    status: 'dismissed',
    task_id: null,
    dismissal_reason: 'insufficient_evidence',
    dismissal_note: 'Review after crawl.',
    evidence_snapshot: snapshot,
    status_history: [{
        version: 1,
        status: 'dismissed',
        reason: 'insufficient_evidence',
        at: '2026-09-11T01:00:00Z',
    }],
    created_at: '2026-09-11T00:00:00Z',
    updated_at: '2026-09-11T01:00:00Z',
    tasks: null,
};

test('row mapper preserves decisions, evidence, history, and nullable task links', () => {
    const result = rowToSearchInvestigation(row);

    assert.equal(result.dismissalReason, 'insufficient_evidence');
    assert.equal(result.dismissalNote, 'Review after crawl.');
    assert.equal(result.clientId, 'client-1');
    assert.equal(result.taskId, undefined);
    assert.equal(result.linkedTask, undefined);
    assert.equal(result.evidenceSnapshot.impressions, 237);
    assert.equal(result.statusHistory[0].status, 'dismissed');
});

test('row mapper carries the linked task summary when present', () => {
    const result = rowToSearchInvestigation({
        ...row,
        status: 'task_created',
        task_id: 'task-1',
        dismissal_reason: null,
        dismissal_note: null,
        tasks: { id: 'task-1', title: 'Investigate evidence', status: 'todo' },
    });

    assert.deepEqual(result.linkedTask, {
        id: 'task-1',
        title: 'Investigate evidence',
        status: 'todo',
    });
});

test('decision client sends the exact snake-case RPC contract', async () => {
    let call: { name: string; args: Record<string, unknown> } | undefined;
    const client = {
        async rpc(name: string, args: Record<string, unknown>) {
            call = { name, args };
            return { data: { ...row, status: 'open', dismissal_reason: null, dismissal_note: null }, error: null };
        },
    };

    const result = await setSearchInvestigationDecision({
        clientId: 'client-1',
        property: 'sc-domain:ecoworkz.net',
        kind: 'query_page',
        query: 'hardscape contractor',
        page: 'https://www.ecoworkz.net/corona-ca/',
        status: 'open',
        evidenceSnapshot: snapshot,
    }, client);

    assert.equal(result.success, true);
    assert.deepEqual(call, {
        name: 'set_search_investigation_decision',
        args: {
            p_client_id: 'client-1',
            p_property: 'sc-domain:ecoworkz.net',
            p_kind: 'query_page',
            p_query: 'hardscape contractor',
            p_page: 'https://www.ecoworkz.net/corona-ca/',
            p_status: 'open',
            p_dismissal_reason: null,
            p_dismissal_note: null,
            p_evidence_snapshot: snapshot,
        },
    });
});

test('list client scopes the query and surfaces read failures', async () => {
    const calls: Array<[string, unknown?]> = [];
    const query = {
        select(columns: string) { calls.push(['select', columns]); return this; },
        eq(column: string, value: string) { calls.push(['eq', [column, value]]); return this; },
        async order(column: string, options: unknown) {
            calls.push(['order', [column, options]]);
            return { data: null, error: { message: 'database detail' } };
        },
    };
    const client = { from(table: string) { calls.push(['from', table]); return query; } };

    const originalError = console.error;
    console.error = () => {};
    try {
        const result = await getSearchInvestigations('client-1', client);
        assert.deepEqual(result, { success: false, data: [], error: 'Unable to load investigation decisions.' });
    } finally {
        console.error = originalError;
    }
    assert.deepEqual(calls, [
        ['from', 'search_investigations'],
        ['select', '*, tasks(id,title,status)'],
        ['eq', ['client_id', 'client-1']],
        ['order', ['updated_at', { ascending: false }]],
    ]);
});

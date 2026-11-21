import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeProjectTitle } from '../projects/project-cards';
import { updateCampaignInitiativeTitle } from './campaign-initiatives';

const input = { clientId: 'client', assertedOrganizationId: 'org', initiativeId: 'project', title: '  City Pages  ' };

function fakeClient({
    client = { id: 'client', organization_id: 'org' },
    result = { data: { id: 'project' }, error: null } as { data: { id: string } | null; error: object | null },
}: { client?: { id: string; organization_id: string } | null; result?: { data: { id: string } | null; error: object | null } } = {}) {
    const calls: unknown[][] = [];
    const supabase = {
        from(table: string) {
            calls.push(['from', table]);
            return {
                update(payload: unknown) { calls.push(['update', payload]); return this; },
                select(columns: string) { calls.push(['select', columns]); return this; },
                eq(column: string, value: string) { calls.push(['eq', column, value]); return this; },
                async maybeSingle() { return table === 'clients' ? { data: client, error: null } : result; },
            };
        },
    };
    return { calls, supabase: supabase as unknown as NonNullable<Parameters<typeof updateCampaignInitiativeTitle>[1]> };
}

test('project title validation trims and accepts 160 characters', () => {
    assert.equal(normalizeProjectTitle(input.title), 'City Pages');
    const longest = 'a'.repeat(160);
    assert.equal(normalizeProjectTitle(` ${longest} `), longest);
});

test('project rename rejects blank and overlong names before querying', async () => {
    const { calls, supabase } = fakeClient();
    for (const title of ['', ' \t\n ']) {
        await assert.rejects(updateCampaignInitiativeTitle({ ...input, title }, supabase), { message: 'Project name is required.' });
    }
    await assert.rejects(updateCampaignInitiativeTitle({ ...input, title: 'a'.repeat(161) }, supabase), { message: 'Project name is too long.' });
    assert.deepEqual(calls, []);
});

test('project rename writes only the trimmed title in the resolved scope', async () => {
    const { calls, supabase } = fakeClient();
    await updateCampaignInitiativeTitle({ ...input, assertedOrganizationId: ' org ' }, supabase);
    assert.deepEqual(calls, [
        ['from', 'clients'], ['select', 'id, organization_id'], ['eq', 'id', 'client'],
        ['from', 'campaign_initiatives'], ['update', { title: 'City Pages' }],
        ['eq', 'id', 'project'], ['eq', 'client_id', 'client'], ['eq', 'organization_id', 'org'], ['select', 'id'],
    ]);
});

test('project rename rejects a missing Supabase client', async () => {
    await assert.rejects(updateCampaignInitiativeTitle(input, null), { message: 'Could not rename the project.' });
});

test('project rename rejects missing or mismatched scope without writing', async () => {
    const missing = fakeClient({ client: null });
    const mismatched = fakeClient({ client: { id: 'client', organization_id: 'other' } });
    await assert.rejects(updateCampaignInitiativeTitle(input, missing.supabase), { message: 'This client is not available.' });
    await assert.rejects(updateCampaignInitiativeTitle(input, mismatched.supabase), { message: 'Client does not belong to this organization.' });
    for (const { calls } of [missing, mismatched]) {
        assert.deepEqual(calls, [['from', 'clients'], ['select', 'id, organization_id'], ['eq', 'id', 'client']]);
    }
});

test('project rename rejects a missing row or Supabase write error', async () => {
    for (const error of [null, { message: 'database error' }]) {
        const { supabase } = fakeClient({ result: { data: null, error } });
        await assert.rejects(updateCampaignInitiativeTitle(input, supabase), { message: 'Could not rename the project.' });
    }
});

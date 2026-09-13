import test from 'node:test';
import assert from 'node:assert/strict';

const completeClientRow = {
    id: 'client-1',
    organization_id: 'org-1',
    name: 'Acme',
    launch_date: '2026-01-01',
    seo_hours: 10,
    engagement_model: 'Retainer',
    deliverables_spec: '',
    blogs_due_per_month: 0,
    account_manager_name: 'Alex',
    account_manager_id: 'member-1',
    campaign_total_blogs: null,
    status: 'active',
    tier: 1,
    logo_url: null,
    domain: 'example.com',
    avg_deal_value: 4500,
};

test('a deal-value-only client update preserves every omitted field', async () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    let outgoingBody: unknown;

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        outgoingBody = await request.clone().json();
        return new Response(JSON.stringify(completeClientRow), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };

    try {
        const { updateClientProject } = await import('./clients.ts');
        const result = await updateClientProject('client-1', { avgDealValue: 4500 });

        assert.equal(result.success, true);
        assert.deepEqual(outgoingBody, { avg_deal_value: 4500 });
    } finally {
        globalThis.fetch = originalFetch;
        if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
        if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
    }
});

test('explicitly undefined optional client fields are cleared to null', async () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    let outgoingBody: unknown;

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        outgoingBody = await request.clone().json();
        return new Response(JSON.stringify({
            ...completeClientRow,
            launch_date: null,
            account_manager_id: null,
            campaign_total_blogs: null,
            logo_url: null,
            domain: null,
            avg_deal_value: null,
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };

    try {
        const { updateClientProject } = await import('./clients.ts');
        const result = await updateClientProject('client-1', {
            launchDate: undefined,
            accountManagerId: undefined,
            campaignTotalBlogs: undefined,
            logoUrl: undefined,
            domain: undefined,
            avgDealValue: undefined,
        });

        assert.equal(result.success, true);
        assert.deepEqual(outgoingBody, {
            launch_date: null,
            account_manager_id: null,
            campaign_total_blogs: null,
            logo_url: null,
            domain: null,
            avg_deal_value: null,
        });
    } finally {
        globalThis.fetch = originalFetch;
        if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
        if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
    }
});

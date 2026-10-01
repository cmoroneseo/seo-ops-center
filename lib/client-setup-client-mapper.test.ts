import test from 'node:test';
import assert from 'node:assert/strict';
import { clientProjectToRow, rowToClientProject } from './supabase/clients';
test('partial client updates preserve launch and manager; explicit clearing remains possible', () => {
    const partial = clientProjectToRow({ clientName: 'New name' });
    assert.equal(partial.launch_date, undefined);
    assert.equal(partial.account_manager_id, undefined);
    assert.equal(partial.campaign_total_blogs, undefined);
    const clear = clientProjectToRow({ launchDate: undefined, accountManagerId: undefined, campaignTotalBlogs: undefined });
    assert.equal(clear.launch_date, null);
    assert.equal(clear.account_manager_id, null);
    assert.equal(clear.campaign_total_blogs, null);
});

test('custom setup round trips as a total estimate rather than a monthly retainer', () => {
    const client = rowToClientProject({ id: 'id', organization_id: 'org', name: 'Custom client', engagement_model: 'Campaign', seo_hours: 30, campaign_total_hours: 30, campaign_end: '2026-12-31', onboarding_date: '2026-09-01', status: 'onboarding', setup_scope: { version: 1, mode: 'custom', contentPieces: 0, hoursMode: 'committed', onboardingBudget: 'separate' } });
    assert.equal(client.campaignConfig?.totalHours, 30);
    assert.equal(client.campaignConfig?.endDate, '2026-12-31');
    assert.equal(client.setupScope?.mode, 'custom');
    assert.equal(client.onboardingDate, '2026-09-01');
});

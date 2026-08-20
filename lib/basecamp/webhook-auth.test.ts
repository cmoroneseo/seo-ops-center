import { test } from 'node:test';
import assert from 'node:assert/strict';

test('Basecamp webhook accepts only the constant-time header secret and rejects query credentials', async () => {
    const { isAuthorizedBasecampWebhook } = await import('./webhook-auth.ts');
    const configured = 'high-entropy-secret';

    assert.equal(isAuthorizedBasecampWebhook(
        new Request('https://seo-ops.test/api/integrations/basecamp/webhook?secret=high-entropy-secret'),
        configured,
    ), false);
    assert.equal(isAuthorizedBasecampWebhook(new Request(
        'https://seo-ops.test/api/integrations/basecamp/webhook',
        { headers: { 'x-basecamp-webhook-secret': configured } },
    ), configured), true);
    assert.equal(isAuthorizedBasecampWebhook(new Request(
        'https://seo-ops.test/api/integrations/basecamp/webhook',
        { headers: { 'x-basecamp-webhook-secret': 'wrong' } },
    ), configured), false);
    assert.equal(isAuthorizedBasecampWebhook(new Request(
        'https://seo-ops.test/api/integrations/basecamp/webhook',
    ), undefined), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { botRequestDecision } from './scope.ts';

const token = 'Bearer seo_bot_example';

test('a bot key may only POST the time route', () => {
    assert.equal(botRequestDecision({
        pathname: '/api/bots/time',
        method: 'POST',
        authorization: token,
    }), 'allow');
    assert.equal(botRequestDecision({
        pathname: '/api/bots/time',
        method: 'GET',
        authorization: token,
    }), 'forbid');
    assert.equal(botRequestDecision({
        pathname: '/api/bots/keys',
        method: 'POST',
        authorization: token,
    }), 'forbid');
    assert.equal(botRequestDecision({
        pathname: '/api/integrations/basecamp/push',
        method: 'POST',
        authorization: token,
    }), 'forbid');
    assert.equal(botRequestDecision({
        pathname: '/api/clients/abc',
        method: 'DELETE',
        authorization: token,
    }), 'forbid');
    assert.equal(botRequestDecision({
        pathname: '/api/bots/time',
        method: 'POST',
        authorization: null,
    }), 'ignore');
    assert.equal(botRequestDecision({
        pathname: '/api/cron/sync-gsc-history',
        method: 'GET',
        authorization: 'Bearer some-other-secret',
    }), 'ignore');
});

test('middleware rejects every other route before the session redirect', () => {
    const middleware = readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8');
    const decision = middleware.indexOf('botRequestDecision');
    const session = middleware.indexOf('supabase.auth.getUser');
    assert.equal(decision > 0, true);
    assert.equal(session > decision, true);
    assert.match(middleware, /status: 403/);
});

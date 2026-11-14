import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { botRequestDecision } from './scope.ts';

const token = 'Bearer seo_bot_example';

test('a bot key may POST task create, approvals, and timer start/stop only', () => {
    assert.equal(botRequestDecision({
        pathname: '/api/bots/tasks',
        method: 'POST',
        authorization: token,
    }), 'allow');
    assert.equal(botRequestDecision({
        pathname: '/api/bots/approvals',
        method: 'POST',
        authorization: token,
    }), 'allow');
    assert.equal(botRequestDecision({
        pathname: '/api/gbp-approvals/requests/00000000-0000-4000-8000-000000000001/link',
        method: 'POST',
        authorization: token,
    }), 'forbid');
    assert.equal(botRequestDecision({
        pathname: '/api/bots/timer/start',
        method: 'POST',
        authorization: token,
    }), 'allow');
    assert.equal(botRequestDecision({
        pathname: '/api/bots/timer/stop',
        method: 'POST',
        authorization: token,
    }), 'allow');
    assert.equal(botRequestDecision({
        pathname: '/api/bots/timer/pause',
        method: 'POST',
        authorization: token,
    }), 'allow');
    assert.equal(botRequestDecision({
        pathname: '/api/bots/timer/resume',
        method: 'POST',
        authorization: token,
    }), 'allow');
    assert.equal(botRequestDecision({
        pathname: '/api/bots/time',
        method: 'POST',
        authorization: token,
    }), 'forbid');
    assert.equal(botRequestDecision({
        pathname: '/api/bots/timer/start',
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
        pathname: '/api/bots/tasks',
        method: 'POST',
        authorization: null,
    }), 'ignore');
    assert.equal(botRequestDecision({
        pathname: '/api/cron/cap-bot-timers',
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

test('all staff approval operations reject bot keys', () => {
    for (const operation of ['link/issue', 'link/extend', 'link/revoke', 'versions', 'final']) {
        assert.equal(botRequestDecision({ pathname: `/api/gbp-approvals/requests/request-id/${operation}`, method: 'POST', authorization: token }), 'forbid');
    }
});

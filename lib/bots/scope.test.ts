import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

import { middleware as runMiddleware } from '../../middleware.ts';
import { botRequestDecision } from './scope.ts';

const token = 'Bearer seo_bot_example';

test('a bot key may POST task create, approvals, and timer controls', () => {
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

test('the client lookup is the only route a bot key can GET', () => {
    const pathname = '/api/bots/clients';
    assert.equal(botRequestDecision({ pathname, method: 'GET', authorization: token }), 'allow');
    for (const otherPath of ['/api/bots/tasks', '/api/bots/approvals', '/api/bots/keys', `${pathname}/extra`, '/api/clients']) {
        assert.equal(botRequestDecision({ pathname: otherPath, method: 'GET', authorization: token }), 'forbid');
    }
    for (const method of ['POST', 'HEAD', 'DELETE']) {
        assert.equal(botRequestDecision({ pathname, method, authorization: token }), 'forbid');
    }
});

test('middleware forwards client lookup requests to the route for key validation', async () => {
    const url = 'https://seo-ops.example.test/api/bots/clients?name=Alpha';
    for (const authorization of [null, token, 'Bearer wrong-prefix']) {
        const headers = new Headers();
        if (authorization) headers.set('Authorization', authorization);
        const response = await runMiddleware(new NextRequest(url, { headers }));
        assert.equal(response.headers.get('x-middleware-next'), '1');
    }
    const response = await runMiddleware(new NextRequest(url, { method: 'POST', headers: { Authorization: token } }));
    assert.equal(response.status, 403);
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

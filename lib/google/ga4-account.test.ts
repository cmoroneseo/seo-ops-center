import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GoogleAccountEmptyHint } from '../../components/workspace/GoogleAccountEmptyHint.tsx';
import { Ga4PropertyOptions } from '../../components/workspace/GooglePropertyPicker.tsx';
import { IntegrationGrid } from '../../components/workspace/IntegrationGrid.tsx';
import { toPublicIntegration } from '../integrations/public-integration.ts';
import { GOOGLE_OAUTH_GROUPS, connectedAccountLabel, googleOAuthPrompt, googleOAuthScopes, isGoogleOAuthGroup, publicGoogleEmail, readGoogleAccountEmail } from './account.ts';
import { readGa4Properties } from './ga4-properties.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const email = 'ada@agency.test';

function page(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('account summaries follow nextPageToken at pageSize 200 and sort by name', async () => {
    const urls: string[] = [];
    const request: typeof fetch = async (input, init) => {
        const url = String(input);
        urls.push(url);
        const header = new Headers(init?.headers).get('authorization') ?? '';
        assert.equal(header, 'Bearer token-secret');
        if (!url.includes('pageToken=')) {
            return page({
                accountSummaries: [{
                    displayName: 'Zeta Account',
                    propertySummaries: [{ property: 'properties/2', displayName: 'Zeta Site' }],
                }],
                nextPageToken: 'page-2',
            });
        }
        return page({
            accountSummaries: [{
                displayName: 'Alpha Account',
                propertySummaries: [
                    { property: 'properties/9', displayName: 'alpha site' },
                    { property: 'properties/1', displayName: 'Alpha Site' },
                ],
            }],
        });
    };
    const properties = await readGa4Properties('token-secret', request, () => { throw new Error('must not log success'); });
    assert.equal(urls.length, 2);
    assert.match(urls[0], /pageSize=200/);
    assert.equal(urls[0].includes('pageToken'), false);
    assert.match(urls[1], /pageToken=page-2/);
    assert.equal(urls.join('\n').includes('token-secret'), false);
    assert.deepEqual(properties.map(property => property.displayName), ['Alpha Site', 'alpha site', 'Zeta Site']);
    assert.deepEqual(properties.map(property => property.id), ['properties/1', 'properties/9', 'properties/2']);
});

test('a repeated page token stops the walk', async () => {
    let calls = 0;
    const request: typeof fetch = async () => {
        calls += 1;
        return page({ accountSummaries: [], nextPageToken: 'again' });
    };
    assert.deepEqual(await readGa4Properties('token', request, () => undefined), []);
    assert.equal(calls, 2);
});

test('a failed account summary page logs only the status', async () => {
    const logs: unknown[] = [];
    await assert.rejects(
        () => readGa4Properties('token-secret', async () => page({ error: { message: 'token-secret leaked in body' } }, 403), status => logs.push(status)),
        (error: Error) => {
            assert.equal(error.message.includes('token-secret'), false);
            assert.equal(error.message.includes('leaked'), false);
            return true;
        },
    );
    assert.deepEqual(logs, [403]);
});

test('connect asks for openid email and an account chooser', () => {
    assert.deepEqual(googleOAuthScopes('ga4'), [
        'https://www.googleapis.com/auth/analytics.readonly',
        'openid',
        'email',
    ]);
    assert.ok(googleOAuthScopes('gsc').includes('openid'));
    assert.ok(googleOAuthScopes('ga4-gsc').includes('email'));
    assert.ok(googleOAuthScopes('gbp').includes('openid'));
    assert.deepEqual([...GOOGLE_OAUTH_GROUPS].sort(), ['ga4', 'ga4-gsc', 'gbp', 'gsc']);
    assert.equal(isGoogleOAuthGroup('ga4'), true);
    assert.equal(isGoogleOAuthGroup('nope'), false);
    assert.equal(isGoogleOAuthGroup(null), false);
    assert.equal(isGoogleOAuthGroup(''), false);
    assert.equal(googleOAuthPrompt(), 'consent select_account');
});

test('userinfo stores an email and logs only a status on failure', async () => {
    const ok = await readGoogleAccountEmail('token-secret', async () => page({ email, email_verified: true }));
    assert.equal(ok, email);
    const logs: unknown[] = [];
    const missing = await readGoogleAccountEmail('token-secret', async () => page({ error: 'token-secret' }, 401), status => logs.push(status));
    assert.equal(missing, null);
    assert.deepEqual(logs, [401]);
    assert.equal(JSON.stringify(logs).includes('token-secret'), false);
    assert.equal(await readGoogleAccountEmail('token', async () => page({ email, email_verified: false })), null);
    assert.equal(publicGoogleEmail({ google_email: 'not an email', access_token: 'token-secret' }), undefined);
});

test('the browser integration hides tokens and shows the Google account', () => {
    const safe = toPublicIntegration({
        id: '1',
        organization_id: 'org',
        client_id: 'client',
        service: 'ga4',
        credentials: { access_token: 'token-secret', refresh_token: 'refresh-secret', google_email: email, property_id: 'properties/1' },
        connected_by: 'user',
        connected_at: '2026-10-14T00:00:00Z',
        sync_status: 'pending_setup',
    });
    assert.equal(safe.googleEmail, email);
    assert.equal(connectedAccountLabel(safe.googleEmail), `Connected as ${email}`);
    const serialized = JSON.stringify(safe);
    assert.equal(serialized.includes('token-secret'), false);
    assert.equal(serialized.includes('refresh-secret'), false);
    const disconnected = toPublicIntegration({
        id: '1', organization_id: 'org', client_id: 'client', service: 'gsc',
        credentials: { google_email: email, site_url: 'sc-domain:example.com' },
        connected_at: '2026-10-14T00:00:00Z', sync_status: 'disconnected',
    });
    assert.equal(disconnected.googleEmail, undefined);
    assert.equal(disconnected.selectedProperty, undefined);
});

test('empty property lists name the connected account and offer reconnect', () => {
    let reconnects = 0;
    const html = renderToStaticMarkup(createElement(Ga4PropertyOptions, {
        properties: [],
        selected: '',
        query: '',
        onQueryChange: () => undefined,
        onSelect: () => undefined,
        googleEmail: email,
        onReconnect: () => { reconnects += 1; },
    }));
    assert.match(html, /No options found on this account/);
    assert.match(html, /Don(?:'|&#x27;)t see it\? This list shows properties for /);
    assert.match(html, /Reconnect with another Google account/);
    assert.equal(html.includes('token-secret'), false);
    assert.equal(reconnects, 0);

    const card = renderToStaticMarkup(createElement(IntegrationGrid, {
        items: [{
            id: 'ga4',
            name: 'Google Analytics 4',
            description: 'Sessions, new visitors, bounce rate',
            status: 'Complete setup',
            tone: 'attention',
            accountLabel: connectedAccountLabel(email),
        }, {
            id: 'gsc',
            name: 'Google Search Console',
            description: 'Organic traffic, impressions, keyword positions',
            status: 'Connected',
            tone: 'connected',
            accountLabel: connectedAccountLabel(email),
        }],
        selected: null,
        onSelect: () => undefined,
    }));
    assert.equal((card.match(/Connected as /g) || []).length, 2);
    assert.equal(card.includes('>1<'), false);

    const hint = renderToStaticMarkup(createElement(GoogleAccountEmptyHint, { email, onReconnect: () => undefined }));
    assert.match(hint, /<button/);
    assert.equal(renderToStaticMarkup(createElement(GoogleAccountEmptyHint, { onReconnect: () => undefined })), '');
});

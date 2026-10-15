import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ga4KeyEventOptions } from '../../components/workspace/Ga4KeyEventPicker.tsx';
import { GA4_ANALYTICS_SCOPE, googleConnectPath, syncStatusAfterGoogleReconnect } from '../google/account.ts';
import { reconnectCredentials } from '../google/gsc-properties.ts';
import { toPublicIntegration } from '../integrations/public-integration.ts';
import { GA4_REAUTH_ERROR, GA4_RECONNECT_ANALYTICS_LABEL, ga4ConnectionHealth, parseGrantedScopes } from './connection-health.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('the callback scope string becomes a grant list and a partial grant asks for Analytics', () => {
    assert.deepEqual(parseGrantedScopes(`openid email ${GA4_ANALYTICS_SCOPE} ${GA4_ANALYTICS_SCOPE}`), [
        'openid', 'email', GA4_ANALYTICS_SCOPE,
    ]);
    assert.deepEqual(parseGrantedScopes(''), []);
    assert.deepEqual(parseGrantedScopes(undefined), []);
    assert.equal(ga4ConnectionHealth({ syncStatus: 'active', grantedScopes: ['openid', 'email'] }), 'reconnect_analytics');
    assert.equal(ga4ConnectionHealth({ syncStatus: 'active', grantedScopes: [GA4_ANALYTICS_SCOPE] }), null);
    assert.equal(ga4ConnectionHealth({ syncStatus: 'active' }), null);
    assert.equal(ga4ConnectionHealth({ syncStatus: 'disconnected', grantedScopes: [] }), null);
    assert.equal(ga4ConnectionHealth({ syncStatus: 'error', errorMessage: GA4_REAUTH_ERROR, grantedScopes: [GA4_ANALYTICS_SCOPE] }), 'reauth_required');
});

test('a reconnect keeps the previous grant when Google omits scope and replaces it when scope is present', () => {
    const kept = reconnectCredentials(
        { property_id: 'properties/1', granted_scopes: [GA4_ANALYTICS_SCOPE], refresh_token: 'old-secret' },
        { access_token: 'new' },
    );
    assert.deepEqual(kept.granted_scopes, [GA4_ANALYTICS_SCOPE]);
    assert.equal(kept.refresh_token, undefined);
    const replaced = reconnectCredentials(
        { granted_scopes: ['openid'] },
        { access_token: 'new', granted_scopes: ['openid', GA4_ANALYTICS_SCOPE] },
    );
    assert.deepEqual(replaced.granted_scopes, ['openid', GA4_ANALYTICS_SCOPE]);
});

test('the browser sees the reconnect state and not the scope list or tokens', () => {
    const safe = toPublicIntegration({
        id: '1', organization_id: 'org', client_id: 'client', service: 'ga4',
        credentials: { access_token: 'token-secret', granted_scopes: ['openid'], property_id: 'properties/1' },
        connected_at: '2026-10-14T00:00:00Z', sync_status: 'active',
    });
    assert.equal(safe.connectionHealth, 'reconnect_analytics');
    const serialized = JSON.stringify(safe);
    assert.equal(serialized.includes('token-secret'), false);
    assert.equal(serialized.includes('granted_scopes'), false);
    assert.equal(serialized.includes(GA4_ANALYTICS_SCOPE), false);
});

test('GA4 connect uses the shared ga4-gsc group and an existing property stays active', () => {
    assert.match(googleConnectPath('client', 'org', 'ga4-gsc'), /group=ga4-gsc/);
    assert.equal(googleConnectPath('client', 'org', 'ga4-gsc').includes('group=ga4&'), false);
    assert.equal(syncStatusAfterGoogleReconnect({
        service: 'ga4', previousStatus: 'active', credentials: { property_id: 'properties/1' },
    }), 'active');
    assert.equal(syncStatusAfterGoogleReconnect({
        service: 'gsc', previousStatus: 'active', credentials: { site_url: 'sc-domain:example.com' },
    }), 'active');
    assert.equal(syncStatusAfterGoogleReconnect({ service: 'ga4', previousStatus: 'pending_setup', credentials: {} }), 'pending_setup');
});

test('the key event picker can choose a subset and the reconnect label is the Analytics one', () => {
    const html = renderToStaticMarkup(createElement(Ga4KeyEventOptions, {
        events: [{ eventName: 'purchase' }, { eventName: 'generate_lead' }],
        useAll: false,
        selected: ['purchase'],
        onUseAll: () => undefined,
        onToggle: () => undefined,
    }));
    assert.match(html, /purchase/);
    assert.match(html, /generate_lead/);
    assert.match(html, /Use all key events/);
    assert.equal(GA4_RECONNECT_ANALYTICS_LABEL, 'Reconnect to add Analytics');
});

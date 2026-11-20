import test from 'node:test';
import assert from 'node:assert/strict';

import { toPublicIntegration } from '../integrations/public-integration.ts';
import { deriveGoogleAccess } from './google-access.ts';

function integration(service: string, syncStatus: string, credentials: Record<string, unknown> = {}) {
    return toPublicIntegration({
        id: service,
        organization_id: 'org',
        client_id: 'client',
        connected_at: '2026-11-01T00:00:00Z',
        service,
        sync_status: syncStatus,
        credentials,
    });
}

test('Google access starts disconnected for each service without a row', () => {
    assert.deepEqual(deriveGoogleAccess([]), {
        gsc: 'not-connected',
        ga4: 'not-connected',
        gtm: 'not-connected',
    });
});

test('active or pending consent without a saved resource needs a selection', () => {
    assert.deepEqual(deriveGoogleAccess([
        integration('gsc', 'active'),
        integration('ga4', 'pending_setup', { property_id: 'properties/123' }),
        integration('gtm', 'active', { public_id: 'GTM-EXAMPLE' }),
    ]), {
        gsc: 'pick',
        ga4: 'pick',
        gtm: 'pick',
    });
    assert.equal(deriveGoogleAccess([integration('ga4', 'active')]).ga4, 'pick');
});

test('a combined GA4 and GSC grant stores two rows with independent selections', () => {
    const gsc = integration('gsc', 'active', { site_url: 'sc-domain:example.com' });
    const ga4 = integration('ga4', 'active', { property_id: 'properties/123' });
    assert.deepEqual(deriveGoogleAccess([gsc, ga4]), {
        gsc: 'connected',
        ga4: 'connected',
        gtm: 'not-connected',
    });
    assert.equal(deriveGoogleAccess([gsc, integration('ga4', 'active')]).ga4, 'pick');
});

test('GTM is connected with a saved container ID even without a public tag ID', () => {
    assert.equal(deriveGoogleAccess([
        integration('gtm', 'active', { container_id: '123' }),
    ]).gtm, 'connected');
});

test('errored, expired, or inactive rows need a reconnect even with a saved resource', () => {
    assert.deepEqual(deriveGoogleAccess([
        integration('gsc', 'error', { site_url: 'sc-domain:example.com' }),
        integration('ga4', 'expired', { property_id: 'properties/123' }),
        integration('gtm', 'inactive', { container_id: '123' }),
    ]), {
        gsc: 'needs-reconnect',
        ga4: 'needs-reconnect',
        gtm: 'needs-reconnect',
    });
});

test('an explicitly disconnected integration has no connection to repair', () => {
    assert.equal(deriveGoogleAccess([integration('ga4', 'disconnected')]).ga4, 'not-connected');
});

test('an active GA4 row with a partial consent needs to reconnect for Analytics', () => {
    assert.equal(deriveGoogleAccess([
        integration('ga4', 'active', {
            property_id: 'properties/123',
            granted_scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
        }),
    ]).ga4, 'needs-reconnect');
});

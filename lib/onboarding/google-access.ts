import type { ClientIntegration } from '../types';

export const GOOGLE_ACCESS_SERVICES = ['gsc', 'ga4', 'gtm'] as const;
export type GoogleAccessService = (typeof GOOGLE_ACCESS_SERVICES)[number];
export type GoogleAccessState = 'not-connected' | 'pick' | 'connected' | 'needs-reconnect';
export type GoogleAccess = Record<GoogleAccessService, GoogleAccessState>;

type IntegrationStatus = Pick<ClientIntegration, 'service' | 'selectedProperty' | 'needsPropertySetup' | 'connectionHealth'> & {
    syncStatus: string;
};

function accessState(service: GoogleAccessService, row: IntegrationStatus | undefined): GoogleAccessState {
    if (!row || row.syncStatus === 'disconnected') return 'not-connected';
    if (row.connectionHealth) return 'needs-reconnect';
    if (row.syncStatus === 'pending_setup') return 'pick';
    if (row.syncStatus !== 'active') return 'needs-reconnect';

    // The status endpoint checks credentials.property_id for GA4 and
    // credentials.container_id for GTM without returning either credential blob.
    const hasSelection = service === 'gsc'
        ? !row.needsPropertySetup && !!row.selectedProperty?.trim()
        : row.needsPropertySetup === false;
    return hasSelection ? 'connected' : 'pick';
}

export function deriveGoogleAccess(rows: readonly IntegrationStatus[]): GoogleAccess {
    // Even the combined OAuth grant writes one row per service.
    return {
        gsc: accessState('gsc', rows.find(row => row.service === 'gsc')),
        ga4: accessState('ga4', rows.find(row => row.service === 'ga4')),
        gtm: accessState('gtm', rows.find(row => row.service === 'gtm')),
    };
}

export function googleAccessHref(clientId: string, service: GoogleAccessService): string {
    const setup = service === 'gsc' ? 'search-console' : service;
    return `/workspace/${encodeURIComponent(clientId)}?tab=integrations&setup=${setup}`;
}

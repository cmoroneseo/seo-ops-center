'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, AlertCircle, Unlink, ExternalLink, RefreshCw, Key, Settings2 } from 'lucide-react';
import { ClientIntegration, IntegrationService } from '@/lib/types';
import { getClientIntegrations } from '@/lib/supabase/integrations';
import { GooglePropertyPicker } from './GooglePropertyPicker';
import { useOrganization } from '@/components/providers/organization-provider';
import { cn } from '@/lib/utils';

interface Props {
    clientId: string;
}

interface ServiceConfig {
    service: IntegrationService;
    label: string;
    description: string;
    group: 'ga4-gsc' | 'gbp' | 'ahrefs';
    icon: string;
}

const SERVICES: ServiceConfig[] = [
    {
        service: 'ga4',
        label: 'Google Analytics 4',
        description: 'Sessions, new visitors, bounce rate',
        group: 'ga4-gsc',
        icon: '📊',
    },
    {
        service: 'gsc',
        label: 'Google Search Console',
        description: 'Organic traffic, impressions, keyword positions',
        group: 'ga4-gsc',
        icon: '🔍',
    },
    {
        service: 'gbp',
        label: 'Google Business Profile',
        description: 'GBP impressions, calls, directions, website clicks, reviews',
        group: 'gbp',
        icon: '📍',
    },
    {
        service: 'ahrefs',
        label: 'Ahrefs',
        description: 'Domain Rating, ranked keywords, top 10/20/50',
        group: 'ahrefs',
        icon: '🔗',
    },
];

// GA4 and GSC share one Google OAuth flow — connecting either connects both
const GOOGLE_GROUPS: Record<string, string[]> = {
    'ga4-gsc': ['ga4', 'gsc'],
};

export function IntegrationsTab({ clientId }: Props) {
    const { organization } = useOrganization();
    const searchParams = useSearchParams();
    const router = useRouter();

    const [integrations, setIntegrations] = useState<ClientIntegration[]>([]);
    const [loading, setLoading] = useState(true);
    const [ahrefsKey, setAhrefsKey] = useState('');
    const [ahrefsSaving, setAhrefsSaving] = useState(false);
    const [ahrefsError, setAhrefsError] = useState('');
    const [disconnecting, setDisconnecting] = useState<IntegrationService | null>(null);
    const [showPropertyPicker, setShowPropertyPicker] = useState<'ga4-gsc' | 'gbp' | null>(null);
    const [toast, setToast] = useState('');

    const orgId = organization?.id;

    useEffect(() => {
        if (!clientId) return;
        getClientIntegrations(clientId).then((data) => {
            setIntegrations(data);
            setLoading(false);
        });
    }, [clientId]);

    // Show feedback toast after OAuth redirect
    useEffect(() => {
        const success = searchParams.get('integrationSuccess');
        const error = searchParams.get('integrationError');
        if (success) {
            // Refresh integrations list
            getClientIntegrations(clientId).then(setIntegrations);
            // Both groups need a location/property picker before they're fully active
            if (success === 'ga4-gsc') {
                setShowPropertyPicker('ga4-gsc');
            } else if (success === 'gbp') {
                setShowPropertyPicker('gbp');
            }
            // Strip query param
            const url = new URL(window.location.href);
            url.searchParams.delete('integrationSuccess');
            router.replace(url.pathname + url.search);
        } else if (error) {
            setToast(`Connection failed: ${error.replace(/_/g, ' ')}`);
            const url = new URL(window.location.href);
            url.searchParams.delete('integrationError');
            router.replace(url.pathname + url.search);
        }
    }, []);

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(''), 4000);
        return () => clearTimeout(t);
    }, [toast]);

    function getIntegration(service: IntegrationService) {
        return integrations.find((i) => i.service === service);
    }

    function isConnected(service: IntegrationService) {
        const i = getIntegration(service);
        return i?.syncStatus === 'active';
    }

    function isPendingSetup(service: IntegrationService) {
        const i = getIntegration(service);
        return (i?.syncStatus as string) === 'pending_setup';
    }

    function connectGoogle(group: 'ga4-gsc' | 'gbp') {
        if (!orgId) return;
        const url = `/api/integrations/google/connect?clientId=${clientId}&orgId=${orgId}&group=${group}`;
        window.location.href = url;
    }

    async function saveAhrefsKey() {
        if (!orgId || !ahrefsKey.trim()) return;
        setAhrefsSaving(true);
        setAhrefsError('');
        try {
            const res = await fetch('/api/integrations/ahrefs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, orgId, apiKey: ahrefsKey.trim() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Unknown error');
            setAhrefsKey('');
            setToast('Ahrefs connected successfully');
            const updated = await getClientIntegrations(clientId);
            setIntegrations(updated);
        } catch (err: any) {
            setAhrefsError(err.message);
        } finally {
            setAhrefsSaving(false);
        }
    }

    async function disconnect(service: IntegrationService) {
        setDisconnecting(service);
        try {
            const res = await fetch(`/api/integrations/ahrefs?clientId=${clientId}&service=${service}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                setIntegrations((prev) =>
                    prev.map((i) => i.service === service ? { ...i, syncStatus: 'disconnected' } : i),
                );
                setToast(`${service.toUpperCase()} disconnected`);
            }
        } finally {
            setDisconnecting(null);
        }
    }

    if (loading) {
        return <div className="text-sm text-muted-foreground p-4">Loading integrations...</div>;
    }

    return (
        <div className="space-y-4">
            {showPropertyPicker && orgId && (
                <GooglePropertyPicker
                    clientId={clientId}
                    orgId={orgId}
                    group={showPropertyPicker}
                    onComplete={async () => {
                        const label = showPropertyPicker === 'ga4-gsc' ? 'GA4 + GSC' : 'Google Business Profile';
                        setShowPropertyPicker(null);
                        setToast(`${label} connected successfully`);
                        const updated = await getClientIntegrations(clientId);
                        setIntegrations(updated);
                    }}
                    onCancel={() => setShowPropertyPicker(null)}
                />
            )}
            {/* Toast */}
            {toast && (
                <div className="fixed bottom-6 right-6 z-50 bg-card border border-border rounded-lg px-4 py-3 text-sm shadow-lg flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    {toast}
                </div>
            )}

            <div className="space-y-3">
                {SERVICES.map((cfg) => {
                    const integration = getIntegration(cfg.service);
                    const connected = isConnected(cfg.service);
                    const pendingSetup = isPendingSetup(cfg.service);
                    const needsPropertySetup = integration?.needsPropertySetup ?? false;
                    const hasError = integration?.syncStatus === 'error';
                    // GA4 and GSC share one connect button — show the button on GA4, hide on GSC
                    const isGscShared = cfg.service === 'gsc';

                    return (
                        <div
                            key={cfg.service}
                            className={cn(
                                'flex items-start justify-between rounded-xl border p-4 gap-4',
                                (pendingSetup || needsPropertySetup) ? 'border-yellow-500/20 bg-yellow-500/5' :
                                connected ? 'border-green-500/20 bg-green-500/5' :
                                hasError ? 'border-red-500/20 bg-red-500/5' :
                                'border-border/50 bg-card',
                            )}
                        >
                            <div className="flex items-start gap-3 min-w-0">
                                <span className="text-xl mt-0.5">{cfg.icon}</span>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium text-sm">{cfg.label}</span>
                                        {isGscShared && connected && (
                                            <span className="text-xs text-muted-foreground">(shared with GA4 auth)</span>
                                        )}
                                        {connected && !needsPropertySetup && (
                                            <span className="flex items-center gap-1 text-xs text-green-500">
                                                <CheckCircle2 className="h-3 w-3" />
                                                Connected
                                            </span>
                                        )}
                                        {connected && needsPropertySetup && (
                                            <span className="flex items-center gap-1 text-xs text-yellow-500">
                                                <Settings2 className="h-3 w-3" />
                                                Property not selected
                                            </span>
                                        )}
                                        {pendingSetup && (
                                            <span className="flex items-center gap-1 text-xs text-yellow-500">
                                                <Settings2 className="h-3 w-3" />
                                                Select property
                                            </span>
                                        )}
                                        {hasError && (
                                            <span className="flex items-center gap-1 text-xs text-red-500">
                                                <AlertCircle className="h-3 w-3" />
                                                Error — reconnect required
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">{cfg.description}</p>
                                    {integration?.lastSyncedAt && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Last synced: {new Date(integration.lastSyncedAt).toLocaleDateString()}
                                        </p>
                                    )}
                                    {hasError && integration?.errorMessage && (
                                        <p className="text-xs text-red-500 mt-1">{integration.errorMessage}</p>
                                    )}
                                </div>
                            </div>

                            {/* Action column */}
                            <div className="shrink-0 flex flex-col items-end gap-2">
                                {cfg.service === 'ahrefs' ? (
                                    connected ? (
                                        <button
                                            onClick={() => disconnect('ahrefs')}
                                            disabled={disconnecting === 'ahrefs'}
                                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-500 border border-border hover:border-red-500/30 rounded-md px-2.5 py-1.5 transition-all"
                                        >
                                            <Unlink className="h-3.5 w-3.5" />
                                            Disconnect
                                        </button>
                                    ) : (
                                        <div className="flex items-end gap-2">
                                            <div className="flex flex-col gap-1">
                                                <input
                                                    type="password"
                                                    value={ahrefsKey}
                                                    onChange={(e) => setAhrefsKey(e.target.value)}
                                                    placeholder="Ahrefs API key"
                                                    className="text-xs bg-background border border-border rounded-md px-2 py-1.5 w-48 focus:outline-none focus:ring-1 focus:ring-primary/50"
                                                />
                                                {ahrefsError && (
                                                    <p className="text-xs text-red-500">{ahrefsError}</p>
                                                )}
                                            </div>
                                            <button
                                                onClick={saveAhrefsKey}
                                                disabled={ahrefsSaving || !ahrefsKey.trim()}
                                                className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground rounded-md px-2.5 py-1.5 hover:bg-primary/90 transition-colors disabled:opacity-50"
                                            >
                                                <Key className="h-3.5 w-3.5" />
                                                {ahrefsSaving ? 'Saving...' : 'Save Key'}
                                            </button>
                                        </div>
                                    )
                                ) : isGscShared ? (
                                    // GSC shares auth with GA4 — no separate button
                                    null
                                ) : (
                                    <div className="flex items-center gap-2">
                                        {(connected || hasError || pendingSetup || needsPropertySetup) && (
                                            <button
                                                onClick={() => disconnect(cfg.service)}
                                                disabled={disconnecting === cfg.service}
                                                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-500 border border-border hover:border-red-500/30 rounded-md px-2.5 py-1.5 transition-all"
                                            >
                                                <Unlink className="h-3.5 w-3.5" />
                                                Disconnect
                                            </button>
                                        )}
                                        {(pendingSetup || needsPropertySetup) && cfg.service === 'ga4' && (
                                            <button
                                                onClick={() => setShowPropertyPicker('ga4-gsc')}
                                                className="flex items-center gap-1.5 text-xs bg-yellow-500 text-white rounded-md px-2.5 py-1.5 hover:bg-yellow-500/90 transition-colors"
                                            >
                                                <Settings2 className="h-3.5 w-3.5" />
                                                Select Properties
                                            </button>
                                        )}
                                        {(pendingSetup || needsPropertySetup) && cfg.service === 'gbp' && (
                                            <button
                                                onClick={() => setShowPropertyPicker('gbp')}
                                                className="flex items-center gap-1.5 text-xs bg-yellow-500 text-white rounded-md px-2.5 py-1.5 hover:bg-yellow-500/90 transition-colors"
                                            >
                                                <Settings2 className="h-3.5 w-3.5" />
                                                Select Location
                                            </button>
                                        )}
                                        {/* Let connected+configured users re-pick without full disconnect */}
                                        {connected && !needsPropertySetup && (cfg.service === 'ga4' || cfg.service === 'gbp') && (
                                            <button
                                                onClick={() => setShowPropertyPicker(cfg.service === 'ga4' ? 'ga4-gsc' : 'gbp')}
                                                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border hover:border-primary/40 rounded-md px-2.5 py-1.5 transition-all"
                                            >
                                                <Settings2 className="h-3.5 w-3.5" />
                                                Change
                                            </button>
                                        )}
                                        {!pendingSetup && <button
                                            onClick={() => connectGoogle(cfg.group as 'ga4-gsc' | 'gbp')}
                                            className={cn(
                                                'flex items-center gap-1.5 text-xs rounded-md px-2.5 py-1.5 transition-all border',
                                                connected
                                                    ? 'text-muted-foreground border-border hover:border-primary/40 hover:text-foreground'
                                                    : 'bg-primary text-primary-foreground border-primary hover:bg-primary/90',
                                            )}
                                        >
                                            {connected ? (
                                                <>
                                                    <RefreshCw className="h-3.5 w-3.5" />
                                                    Reconnect
                                                </>
                                            ) : (
                                                <>
                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                    {cfg.group === 'ga4-gsc' ? 'Connect GA4 + GSC' : 'Connect GBP'}
                                                </>
                                            )}
                                        </button>}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="rounded-xl border border-border/30 bg-muted/20 p-4 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground/60">How it works</p>
                <p>GA4 + GSC share a single Google login — click once to authorize both. GBP requires a separate Google authorization. Ahrefs uses a single API key across all clients — enter it once per client or set a global key in org settings (coming soon).</p>
                <p>Data syncs nightly. You can trigger a manual sync from the Analytics page once connected.</p>
            </div>
        </div>
    );
}

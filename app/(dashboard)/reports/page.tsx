'use client';

import { useState, useEffect } from 'react';
import { Plus, RefreshCw, Pencil, AlertCircle, CheckCircle2, Clock, BarChart3 } from 'lucide-react';
import { useOrganization } from '@/components/providers/organization-provider';
import { getClients } from '@/lib/supabase/clients';
import { ClientProject } from '@/lib/types';
import { ManualMetricsModal } from '@/components/reports/ManualMetricsModal';
import { cn } from '@/lib/utils';

interface MetricRow {
    source: string;
    metric_month: string;
    data: Record<string, any>;
    source_type: string;
}

const SOURCE_LABELS: Record<string, string> = {
    ga4: 'Google Analytics 4',
    gsc: 'Google Search Console',
    gbp: 'Google Business Profile',
    ahrefs: 'Ahrefs',
};

const SOURCE_ICONS: Record<string, string> = {
    ga4: '📊', gsc: '🔍', gbp: '📍', ahrefs: '🔗',
};

const METRIC_LABELS: Record<string, Record<string, string>> = {
    ga4: { sessions: 'Sessions', new_users: 'New Users', bounce_rate: 'Bounce Rate', organic_sessions: 'Organic Sessions' },
    gsc: { organic_clicks: 'Organic Clicks', impressions: 'Impressions', avg_position: 'Avg Position', ctr: 'CTR' },
    gbp: { impressions: 'Impressions', calls: 'Calls', direction_requests: 'Directions', website_clicks: 'Website Clicks', review_count: 'Reviews', avg_rating: 'Avg Rating' },
    ahrefs: { domain_rating: 'Domain Rating', ranked_keywords: 'Ranked Keywords', top_10_keywords: 'Top 10', top_20_keywords: 'Top 20', top_50_keywords: 'Top 50' },
};

function MetricValue({ label, value }: { label: string; value: any }) {
    const display = typeof value === 'number'
        ? value % 1 === 0 ? value.toLocaleString() : value.toFixed(1)
        : String(value ?? '—');
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
            <span className="text-sm font-semibold">{display}</span>
        </div>
    );
}

export default function ReportsPage() {
    const { organization } = useOrganization();
    const [clients, setClients] = useState<ClientProject[]>([]);
    const [selectedClient, setSelectedClient] = useState<ClientProject | null>(null);
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [metrics, setMetrics] = useState<MetricRow[]>([]);
    const [loadingMetrics, setLoadingMetrics] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState('');
    const [manualSource, setManualSource] = useState<string | null>(null);

    useEffect(() => {
        if (!organization) return;
        getClients(organization.id).then(all => {
            const active = all.filter(c => c.status === 'Active');
            setClients(active);
            if (active.length > 0) setSelectedClient(active[0]);
        });
    }, [organization?.id]);

    useEffect(() => {
        if (!selectedClient) return;
        setLoadingMetrics(true);
        fetch(`/api/metrics?clientId=${selectedClient.id}&month=${selectedMonth}`)
            .then(r => r.json())
            .then(d => { setMetrics(d.metrics ?? []); setLoadingMetrics(false); })
            .catch(() => setLoadingMetrics(false));
    }, [selectedClient?.id, selectedMonth]);

    const monthLabel = (m: string) =>
        new Date(m + '-15').toLocaleString('default', { month: 'long', year: 'numeric' });

    const monthOptions = Array.from({ length: 12 }, (_, i) => {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    async function triggerSync() {
        if (!selectedClient) return;
        setSyncing(true);
        setSyncResult('');
        try {
            const res = await fetch('/api/sync/metrics', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET ?? ''}`,
                },
                body: JSON.stringify({ clientId: selectedClient.id, month: selectedMonth }),
            });
            const data = await res.json();
            setSyncResult(res.ok
                ? `Sync complete — ${data.errors === 0 ? 'all sources updated' : `${data.errors} source(s) had errors`}`
                : `Sync failed: ${data.error}`);
            if (res.ok) {
                const fresh = await fetch(`/api/metrics?clientId=${selectedClient.id}&month=${selectedMonth}`);
                const freshData = await fresh.json();
                setMetrics(freshData.metrics ?? []);
            }
        } catch (e: any) {
            setSyncResult(`Sync error: ${e.message}`);
        } finally {
            setSyncing(false);
        }
    }

    const sources = ['ga4', 'gsc', 'gbp', 'ahrefs'];

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight neon-gradient-text">Reports</h2>
                <p className="text-muted-foreground mt-1">View synced metrics and enter data manually for any source.</p>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3">
                <select
                    value={selectedClient?.id ?? ''}
                    onChange={e => setSelectedClient(clients.find(c => c.id === e.target.value) ?? null)}
                    className="text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                    {clients.map(c => <option key={c.id} value={c.id}>{c.clientName}</option>)}
                </select>

                <select
                    value={selectedMonth}
                    onChange={e => setSelectedMonth(e.target.value)}
                    className="text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                    {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>

                <button
                    onClick={triggerSync}
                    disabled={syncing || !selectedClient}
                    className="flex items-center gap-2 text-sm border border-border rounded-lg px-3 py-2 hover:bg-muted transition-colors disabled:opacity-50"
                >
                    <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
                    {syncing ? 'Syncing…' : 'Sync Now'}
                </button>

                {syncResult && (
                    <span className={cn(
                        'flex items-center gap-1.5 text-xs',
                        syncResult.includes('error') || syncResult.includes('failed') ? 'text-red-500' : 'text-green-500',
                    )}>
                        {syncResult.includes('error') || syncResult.includes('failed')
                            ? <AlertCircle className="h-3.5 w-3.5" />
                            : <CheckCircle2 className="h-3.5 w-3.5" />}
                        {syncResult}
                    </span>
                )}
            </div>

            {/* Metric cards */}
            {selectedClient && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {sources.map(source => {
                        const row = metrics.find(m => m.source === source);
                        const hasData = !!row;
                        const isManual = row?.source_type === 'manual';

                        return (
                            <div
                                key={source}
                                className={cn(
                                    'rounded-xl border p-5 space-y-4',
                                    hasData ? 'border-border/50 bg-card' : 'border-dashed border-border/40 bg-muted/10',
                                )}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                        <span className="text-xl">{SOURCE_ICONS[source]}</span>
                                        <div>
                                            <p className="text-sm font-semibold">{SOURCE_LABELS[source]}</p>
                                            {hasData && (
                                                <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                                    {isManual
                                                        ? <><Pencil className="h-2.5 w-2.5" /> Manually entered</>
                                                        : <><CheckCircle2 className="h-2.5 w-2.5 text-green-500" /> Auto-synced</>}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setManualSource(source)}
                                        className={cn(
                                            'flex items-center gap-1.5 text-xs rounded-md px-2.5 py-1.5 border transition-all',
                                            hasData
                                                ? 'text-muted-foreground border-border hover:border-primary/40 hover:text-foreground'
                                                : 'bg-primary text-primary-foreground border-primary hover:bg-primary/90',
                                        )}
                                    >
                                        {hasData
                                            ? <><Pencil className="h-3 w-3" /> Edit</>
                                            : <><Plus className="h-3 w-3" /> Enter manually</>}
                                    </button>
                                </div>

                                {loadingMetrics ? (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Clock className="h-3.5 w-3.5 animate-pulse" /> Loading…
                                    </div>
                                ) : hasData ? (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                                        {Object.entries(row.data).map(([key, val]) => (
                                            <MetricValue
                                                key={key}
                                                label={METRIC_LABELS[source]?.[key] ?? key}
                                                value={val}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                                        <BarChart3 className="h-4 w-4" />
                                        No data for {monthLabel(selectedMonth)} — sync or enter manually.
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Manual entry modal */}
            {manualSource && selectedClient && organization && (
                <ManualMetricsModal
                    client={selectedClient}
                    orgId={organization.id}
                    source={manualSource}
                    month={selectedMonth}
                    existingData={metrics.find(m => m.source === manualSource)?.data}
                    onClose={() => setManualSource(null)}
                    onSaved={(data) => {
                        setMetrics(prev => [
                            ...prev.filter(m => m.source !== manualSource),
                            { source: manualSource, metric_month: selectedMonth, data, source_type: 'manual' },
                        ]);
                        setManualSource(null);
                    }}
                />
            )}
        </div>
    );
}

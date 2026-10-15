'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface DeskClient {
    id: string;
    name: string;
}

interface MapRow {
    clientId: string;
    name: string;
    domain: string | null;
    savedId: string | null;
    matchedBy: 'manual' | 'name' | null;
    suggestionId: string | null;
    suggestionName: string | null;
    effectiveId: string | null;
}

interface MapResponse {
    storageReady: boolean;
    payloadVersion: 1 | 2;
    connectionEnabled: boolean;
    deskError: string | null;
    unmatched: number;
    deskClients: DeskClient[];
    rows: MapRow[];
    message?: string;
    error?: string;
}

export function ForecastClientMap({ organizationId }: { organizationId: string }) {
    const [data, setData] = useState<MapResponse | null>(null);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [applying, setApplying] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!organizationId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        void fetch(`/api/forecast/client-links?organizationId=${encodeURIComponent(organizationId)}`)
            .then(async response => {
                const payload = await response.json() as MapResponse;
                if (!response.ok) throw new Error(payload.error ?? 'Unable to load client matches');
                return payload;
            })
            .then(payload => {
                if (cancelled) return;
                setData(payload);
                const next: Record<string, string> = {};
                for (const row of payload.rows ?? []) next[row.clientId] = row.effectiveId ?? '';
                setDrafts(next);
            })
            .catch(loadError => {
                if (cancelled) return;
                setData(null);
                setError(loadError instanceof Error ? loadError.message : 'Unable to load client matches');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [organizationId]);

    async function save(clientId: string, campaignDeskClientId: string | null) {
        setSavingId(clientId);
        setError(null);
        try {
            const response = await fetch('/api/forecast/client-links', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ organizationId, clientId, campaignDeskClientId }),
            });
            const payload = await response.json() as MapResponse;
            if (!response.ok) throw new Error(payload.error ?? 'Unable to save the match');
            setData(payload);
            const next: Record<string, string> = {};
            for (const row of payload.rows ?? []) next[row.clientId] = row.effectiveId ?? '';
            setDrafts(next);
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Unable to save the match');
        } finally {
            setSavingId(null);
        }
    }

    async function applyNames() {
        setApplying(true);
        setError(null);
        try {
            const response = await fetch('/api/forecast/client-links', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ organizationId, applyNameMatches: true }),
            });
            const payload = await response.json() as MapResponse;
            if (!response.ok) throw new Error(payload.error ?? 'Unable to save name matches');
            setData(payload);
            const next: Record<string, string> = {};
            for (const row of payload.rows ?? []) next[row.clientId] = row.effectiveId ?? '';
            setDrafts(next);
        } catch (applyError) {
            setError(applyError instanceof Error ? applyError.message : 'Unable to save name matches');
        } finally {
            setApplying(false);
        }
    }

    if (!organizationId) return null;
    const suggestions = data?.rows.filter(row => row.suggestionId && !row.savedId).length ?? 0;

    return (
        <section className="space-y-4" aria-labelledby="forecast-client-map-title">
            <div>
                <h3 id="forecast-client-map-title" className="text-lg font-semibold">Forecast clients</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                    Match each SEO Ops client to a Campaign Desk client. An exact name is suggested when Campaign Desk has one client with that name. A sync sends the name and domain either way.
                    {data?.payloadVersion === 1 && ' Version 2 is off, so the weekly sync does not send these ids yet.'}
                </p>
            </div>

            {loading && <p className="text-sm text-muted-foreground">Loading clients…</p>}
            {error && (
                <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                </p>
            )}
            {data && !data.storageReady && (
                <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                    {data.message}
                </p>
            )}
            {data?.deskError && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
                    {data.deskError}
                </p>
            )}
            {data && data.storageReady && data.rows.length === 0 && !loading && (
                <p className="text-sm text-muted-foreground">No clients in this organization.</p>
            )}

            {data && data.rows.length > 0 && (
                <>
                    <div className="flex flex-wrap items-center gap-3">
                        <p className="text-sm text-muted-foreground">
                            {data.unmatched === 0 ? 'Every client has a match.' : `${data.unmatched} unmatched.`}
                        </p>
                        <button
                            type="button"
                            onClick={() => void applyNames()}
                            disabled={applying || suggestions === 0 || !data.connectionEnabled}
                            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
                        >
                            {applying ? 'Saving…' : `Save ${suggestions} name ${suggestions === 1 ? 'match' : 'matches'}`}
                        </button>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-border">
                        <table className="w-full min-w-[640px] text-sm">
                            <thead className="bg-muted/40 text-left text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-2 font-medium">SEO Ops client</th>
                                    <th className="px-4 py-2 font-medium">Domain</th>
                                    <th className="px-4 py-2 font-medium">Campaign Desk</th>
                                    <th className="px-4 py-2 font-medium"> </th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.map(row => {
                                    const draft = drafts[row.clientId] ?? '';
                                    const dirty = draft !== (row.effectiveId ?? '');
                                    return (
                                        <tr key={row.clientId} className="border-t border-border">
                                            <td className="px-4 py-3">
                                                <div className="font-medium">{row.name}</div>
                                                {row.suggestionName && !row.savedId && (
                                                    <div className="text-xs text-muted-foreground">Suggested: {row.suggestionName}</div>
                                                )}
                                                {row.matchedBy === 'name' && <div className="text-xs text-muted-foreground">Matched by name</div>}
                                                {row.matchedBy === 'manual' && <div className="text-xs text-muted-foreground">Matched by hand</div>}
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground">{row.domain ?? '—'}</td>
                                            <td className="px-4 py-3">
                                                <select
                                                    aria-label={`Campaign Desk client for ${row.name}`}
                                                    value={draft}
                                                    disabled={!data.connectionEnabled || savingId === row.clientId}
                                                    onChange={event => setDrafts(current => ({ ...current, [row.clientId]: event.target.value }))}
                                                    className={cn(
                                                        'w-full rounded-md border border-border bg-background px-2 py-1.5',
                                                        !draft && 'text-muted-foreground',
                                                    )}
                                                >
                                                    <option value="">Unmatched</option>
                                                    {data.deskClients.map(client => (
                                                        <option key={client.id} value={client.id}>{client.name}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    type="button"
                                                    disabled={!dirty || savingId === row.clientId}
                                                    onClick={() => void save(row.clientId, draft || null)}
                                                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                                                >
                                                    {savingId === row.clientId ? 'Saving…' : 'Save'}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </section>
    );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Globe2, Link2, Loader2, RefreshCw, Search, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { describeProperty, filterProperties, isClientMatch, permissionLabel, selectGscProperty, type GscSite } from '@/lib/google/gsc-properties';
import { cn } from '@/lib/utils';

interface Props {
    clientId: string;
    clientName?: string;
    website?: string;
    onClose: () => void;
    onSaved: () => void;
    onReconnect: () => void;
}

export function GscPropertySelector({ clientId, clientName, website, onClose, onSaved, onReconnect }: Props) {
    const [sites, setSites] = useState<GscSite[]>([]);
    const [current, setCurrent] = useState<string | null>(null);
    const [selected, setSelected] = useState('');
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [needsReconnect, setNeedsReconnect] = useState(false);
    const [reload, setReload] = useState(0);
    const mounted = useRef(true);
    const saveController = useRef<AbortController | null>(null);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; saveController.current?.abort(); };
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true); setError(''); setNeedsReconnect(false); setSites([]); setSelected(''); setCurrent(null);
        fetch(`/api/integrations/google/gsc?clientId=${encodeURIComponent(clientId)}`, { signal: controller.signal })
            .then(async response => {
                const data = await response.json();
                if (!response.ok) {
                    if (!controller.signal.aborted) setNeedsReconnect(response.status === 401 || response.status === 403);
                    throw new Error(data.error || 'Unable to load properties.');
                }
                if (controller.signal.aborted) return;
                setSites(data.sites);
                setCurrent(data.selectedSiteUrl);
                setSelected(selectGscProperty(data.sites, data.selectedSiteUrl)?.siteUrl ?? '');
            })
            .catch(err => { if (!controller.signal.aborted) setError(err.message || 'Unable to load properties.'); })
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [clientId, reload]);

    const visible = filterProperties(sites, query, website);
    const validSelection = selectGscProperty(sites, selected);
    const changed = current && selected && current !== selected;

    async function save() {
        if (!validSelection || loading || saving) return;
        setSaving(true); setError('');
        const controller = new AbortController(); saveController.current = controller;
        try {
            const response = await fetch('/api/integrations/google/gsc', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
                body: JSON.stringify({ clientId, siteUrl: selected }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Property could not be saved.');
            if (mounted.current) onSaved();
        } catch (err) {
            if (mounted.current && !controller.signal.aborted) setError(err instanceof Error ? err.message : 'Property could not be saved.');
        } finally { if (mounted.current) setSaving(false); }
    }

    return (
        <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
            <DialogContent className="sm:max-w-3xl max-h-[90dvh] flex flex-col gap-0 p-0 overflow-hidden" showCloseButton={!saving}>
                <DialogHeader className="px-6 pt-6 pb-5 pr-12 text-left">
                    <DialogTitle className="text-xl">Select Search Console property</DialogTitle>
                    <DialogDescription className="leading-relaxed">
                        Choose one primary property for <span className="font-medium text-foreground">{clientName || 'this client'}</span>.
                        {website && <span className="block mt-1 break-all">{website}</span>}
                    </DialogDescription>
                </DialogHeader>
                <div className="px-6 pb-4 flex gap-2">
                    <div className="relative flex-1 min-w-0">
                        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <input aria-label="Search properties" placeholder="Search by domain or URL…" value={query} onChange={e => setQuery(e.target.value)}
                            className="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2.5 text-base sm:text-sm focus-visible:outline-2 focus-visible:outline-ring" />
                    </div>
                    <button type="button" disabled={loading || saving} onClick={() => setReload(v => v + 1)} aria-label="Refresh property list"
                        className="rounded-lg border px-3 hover:bg-muted disabled:opacity-50"><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /></button>
                </div>
                <div className="overflow-y-auto min-h-0 px-6 pb-5 space-y-4">
                    {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /><div>{error}{needsReconnect && <button type="button" onClick={onReconnect} className="block underline mt-2">Reconnect Search Console</button>}</div>
                    </div>}
                    {loading ? <div role="status" className="py-12 text-center text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto mb-3" />Loading your properties…</div> : <>
                        {current && !selectGscProperty(sites, current) && !error && <p className="text-sm text-amber-600 dark:text-amber-400">Your saved property ({current}) is not accessible from this account. Select another property or reconnect.</p>}
                        {!error && sites.length === 0 && <div className="py-8 text-center"><Globe2 className="mx-auto h-8 w-8 text-muted-foreground mb-3" /><p className="font-medium">No Search Console properties found</p><p className="text-sm text-muted-foreground mt-1">Use a Google account that has access to this client’s property, then refresh the list.</p><button type="button" onClick={onReconnect} className="mt-4 text-sm underline">Connect a different Google account</button></div>}
                        {sites.length > 0 && <>
                            <p className="text-xs text-muted-foreground" aria-live="polite">{visible.length} {visible.length === 1 ? 'property' : 'properties'}{website ? ' · Matching domains listed first' : ''}</p>
                            <fieldset disabled={saving} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <legend className="sr-only">Primary Search Console property</legend>
                                {visible.map(site => {
                                    const info = describeProperty(site.siteUrl); const active = selected === site.siteUrl;
                                    const available = !!selectGscProperty([site], site.siteUrl);
                                    const Icon = info.type === 'Domain property' ? Globe2 : Link2;
                                    return <label key={site.siteUrl} className={cn('relative flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-colors hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', active ? 'border-primary bg-primary/5' : 'border-border bg-card', !available && 'opacity-60 cursor-not-allowed')}>
                                        <span className="rounded-lg border bg-background p-2 shrink-0"><Icon className="h-5 w-5 text-muted-foreground" /></span>
                                        <span className="min-w-0 flex-1"><span className="block font-medium text-sm break-all">{info.label}</span><span className="block text-xs text-muted-foreground mt-0.5">{info.type} · {permissionLabel(site.permissionLevel)}</span><span className="block text-xs text-muted-foreground break-all mt-2">{site.siteUrl}</span><span className="flex flex-wrap gap-2 mt-2 text-xs">{current === site.siteUrl && <span className="text-primary">Currently selected</span>}{isClientMatch(site.siteUrl, website) && <span className="text-muted-foreground">Matches client domain</span>}</span></span>
                                        <input type="radio" name="gsc-property" aria-label={`${site.siteUrl}, ${info.type}`} checked={active} onChange={() => setSelected(site.siteUrl)} disabled={!available} className="mt-1 h-4 w-4 accent-current shrink-0" />
                                    </label>;
                                })}
                            </fieldset>
                            {visible.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No properties match “{query}”. Try another domain.</p>}
                        </>}
                    </>}
                    {changed && <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">Future syncs will use the new property. Existing reports are retained and may describe the previous property. Compare periods only when their property scope matches.</p>}
                </div>
                <div className="border-t bg-card px-6 py-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                    <div className="text-xs text-muted-foreground min-w-0 break-all" aria-live="polite">{selected ? <><Check className="inline h-3.5 w-3.5 mr-1" />{selected}</> : 'One primary property per client'}</div>
                    <div className="flex gap-2 shrink-0 justify-end"><button type="button" disabled={saving} onClick={onClose} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50">Cancel</button><button type="button" disabled={!validSelection || loading || saving} onClick={save} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50 flex items-center gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Save property</button></div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

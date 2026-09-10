'use client';
import { Globe2, CheckCircle2, AlertCircle, Settings2, RefreshCw } from 'lucide-react';
import { ClientIntegration } from '@/lib/types';
import { describeProperty } from '@/lib/google/gsc-properties';

export function GscConnectionCard({ integration, onSelect, onConnect }: { integration?: ClientIntegration; onSelect: () => void; onConnect: () => void }) {
    const authorized = integration && integration.syncStatus !== 'disconnected';
    const configured = integration?.syncStatus === 'active' && !!integration.selectedProperty;
    const error = integration?.syncStatus === 'error';
    const property = integration?.selectedProperty ? describeProperty(integration.selectedProperty) : null;
    return <section aria-label="Google Search Console connection" className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex gap-3"><div className="rounded-xl border bg-muted/40 p-2.5 h-fit"><Globe2 className="h-6 w-6 text-primary" /></div><div><h3 className="font-semibold">Google Search Console</h3><p className="text-sm text-muted-foreground mt-1">Connect the search property that represents this client.</p></div></div>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{configured ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <AlertCircle className="h-3.5 w-3.5" />}{configured ? 'Connected' : error ? 'Connection needs attention' : authorized ? 'Select or confirm property' : 'Not connected'}</span>
        </div>
        {property && <div className="rounded-lg border bg-muted/20 px-4 py-3"><p className="text-xs text-muted-foreground mb-1">Primary property · {property.type}</p><p className="text-sm font-medium break-all">{property.scope}</p></div>}
        {error && <p role="status" className="text-xs text-destructive">The last sync failed. Refresh the property list to check access, or reconnect if Google authorization has expired.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{configured ? integration?.lastSyncedAt ? `Last successful sync: ${new Date(integration.lastSyncedAt).toLocaleString()}` : 'Property saved · waiting for the next scheduled data sync' : 'Read-only access · one primary property per client'}</p><div className="flex gap-2">{authorized && <button type="button" onClick={onSelect} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"><Settings2 className="h-4 w-4" />{property ? 'Change property' : 'Select property'}</button>}<button type="button" onClick={onConnect} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted">{authorized && <RefreshCw className="h-4 w-4" />}{authorized ? 'Reconnect' : 'Connect Google'}</button></div></div>
    </section>;
}

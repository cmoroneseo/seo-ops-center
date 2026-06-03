'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

interface GA4Property {
    id: string;
    displayName: string;
    account: string;
}

interface GSCSite {
    siteUrl: string;
    permissionLevel: string;
}

interface Props {
    clientId: string;
    onComplete: () => void;
    onCancel: () => void;
}

export function GooglePropertyPicker({ clientId, onComplete, onCancel }: Props) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [ga4Properties, setGa4Properties] = useState<GA4Property[]>([]);
    const [gscSites, setGscSites] = useState<GSCSite[]>([]);
    const [selectedGA4, setSelectedGA4] = useState('');
    const [selectedGA4Name, setSelectedGA4Name] = useState('');
    const [selectedGSC, setSelectedGSC] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetch(`/api/integrations/google/properties?clientId=${clientId}`)
            .then((r) => r.json())
            .then((data) => {
                if (data.error) throw new Error(data.error);
                setGa4Properties(data.ga4Properties ?? []);
                setGscSites(data.gscSites ?? []);
                // Auto-select if only one option
                if (data.ga4Properties?.length === 1) {
                    setSelectedGA4(data.ga4Properties[0].id);
                    setSelectedGA4Name(data.ga4Properties[0].displayName);
                }
                if (data.gscSites?.length === 1) {
                    setSelectedGSC(data.gscSites[0].siteUrl);
                }
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [clientId]);

    async function handleSave() {
        if (!selectedGA4 || !selectedGSC) return;
        setSaving(true);
        try {
            const res = await fetch('/api/integrations/google/configure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId,
                    ga4PropertyId: selectedGA4,
                    ga4DisplayName: selectedGA4Name,
                    gscSiteUrl: selectedGSC,
                }),
            });
            if (!res.ok) throw new Error((await res.json()).error);
            onComplete();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-5">
                <div>
                    <h2 className="text-lg font-semibold">Select Google Properties</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Choose which GA4 property and Search Console site belong to this client.
                    </p>
                </div>

                {loading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Fetching your Google properties…
                    </div>
                )}

                {error && (
                    <div className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        {error}
                    </div>
                )}

                {!loading && !error && (
                    <div className="space-y-5">
                        {/* GA4 Property */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Google Analytics 4 Property</label>
                            {ga4Properties.length === 0 ? (
                                <p className="text-xs text-muted-foreground italic">No GA4 properties found on this account.</p>
                            ) : (
                                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                    {ga4Properties.map((prop) => (
                                        <button
                                            key={prop.id}
                                            onClick={() => { setSelectedGA4(prop.id); setSelectedGA4Name(prop.displayName); }}
                                            className={`w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-all ${
                                                selectedGA4 === prop.id
                                                    ? 'border-primary bg-primary/10 text-foreground'
                                                    : 'border-border bg-muted/20 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <div>
                                                    <div className="font-medium text-foreground">{prop.displayName}</div>
                                                    <div className="text-xs text-muted-foreground">{prop.account} · {prop.id.replace('properties/', 'ID: ')}</div>
                                                </div>
                                                {selectedGA4 === prop.id && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* GSC Site */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Search Console Site</label>
                            {gscSites.length === 0 ? (
                                <p className="text-xs text-muted-foreground italic">No verified sites found on this account.</p>
                            ) : (
                                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                    {gscSites.map((site) => (
                                        <button
                                            key={site.siteUrl}
                                            onClick={() => setSelectedGSC(site.siteUrl)}
                                            className={`w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-all ${
                                                selectedGSC === site.siteUrl
                                                    ? 'border-primary bg-primary/10 text-foreground'
                                                    : 'border-border bg-muted/20 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <div>
                                                    <div className="font-medium text-foreground">{site.siteUrl}</div>
                                                    <div className="text-xs text-muted-foreground capitalize">{site.permissionLevel.replace('s', 'S')}</div>
                                                </div>
                                                {selectedGSC === site.siteUrl && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                        onClick={onCancel}
                        className="text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-4 py-2 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || !selectedGA4 || !selectedGSC}
                        className="flex items-center gap-2 text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2 hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Confirm Selection
                    </button>
                </div>
            </div>
        </div>
    );
}

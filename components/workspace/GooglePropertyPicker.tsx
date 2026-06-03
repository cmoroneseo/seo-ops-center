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

interface GBPLocation {
    name: string;
    title: string;
    address: string;
    accountName: string;
}

interface Props {
    clientId: string;
    orgId: string;
    group: 'ga4-gsc' | 'gbp';
    onComplete: () => void;
    onCancel: () => void;
}

function PickerList<T>({
    items,
    selected,
    onSelect,
    getKey,
    renderItem,
}: {
    items: T[];
    selected: string;
    onSelect: (key: string) => void;
    getKey: (item: T) => string;
    renderItem: (item: T) => React.ReactNode;
}) {
    if (items.length === 0) {
        return <p className="text-xs text-muted-foreground italic">No options found on this account.</p>;
    }
    return (
        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            {items.map((item) => {
                const key = getKey(item);
                const active = selected === key;
                return (
                    <button
                        key={key}
                        onClick={() => onSelect(key)}
                        className={`w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-all ${
                            active
                                ? 'border-primary bg-primary/10 text-foreground'
                                : 'border-border bg-muted/20 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                        }`}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">{renderItem(item)}</div>
                            {active && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

export function GooglePropertyPicker({ clientId, orgId, group, onComplete, onCancel }: Props) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    // GA4 + GSC state
    const [ga4Properties, setGa4Properties] = useState<GA4Property[]>([]);
    const [gscSites, setGscSites] = useState<GSCSite[]>([]);
    const [selectedGA4, setSelectedGA4] = useState('');
    const [selectedGA4Name, setSelectedGA4Name] = useState('');
    const [selectedGSC, setSelectedGSC] = useState('');

    // GBP state
    const [gbpLocations, setGbpLocations] = useState<GBPLocation[]>([]);
    const [selectedGBP, setSelectedGBP] = useState('');
    const [selectedGBPMeta, setSelectedGBPMeta] = useState<{ title: string; address: string }>({ title: '', address: '' });

    useEffect(() => {
        fetch(`/api/integrations/google/properties?clientId=${clientId}&group=${group}`)
            .then((r) => r.json())
            .then((data) => {
                if (data.error) throw new Error(data.error);
                if (group === 'ga4-gsc') {
                    setGa4Properties(data.ga4Properties ?? []);
                    setGscSites(data.gscSites ?? []);
                    if (data.ga4Properties?.length === 1) {
                        setSelectedGA4(data.ga4Properties[0].id);
                        setSelectedGA4Name(data.ga4Properties[0].displayName);
                    }
                    if (data.gscSites?.length === 1) setSelectedGSC(data.gscSites[0].siteUrl);
                } else {
                    setGbpLocations(data.gbpLocations ?? []);
                    if (data.gbpLocations?.length === 1) {
                        const loc = data.gbpLocations[0];
                        setSelectedGBP(loc.name);
                        setSelectedGBPMeta({ title: loc.title, address: loc.address });
                    }
                }
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [clientId, group]);

    const canSave = group === 'ga4-gsc'
        ? Boolean(selectedGA4 && selectedGSC)
        : Boolean(selectedGBP);

    async function handleSave() {
        if (!canSave) return;
        setSaving(true);
        try {
            const body = group === 'ga4-gsc'
                ? { clientId, orgId, ga4PropertyId: selectedGA4, ga4DisplayName: selectedGA4Name, gscSiteUrl: selectedGSC }
                : { clientId, orgId, gbpLocationName: selectedGBP, gbpTitle: selectedGBPMeta.title, gbpAddress: selectedGBPMeta.address };

            const res = await fetch('/api/integrations/google/configure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error((await res.json()).error);
            onComplete();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    const title = group === 'ga4-gsc' ? 'Select Google Properties' : 'Select Business Location';
    const subtitle = group === 'ga4-gsc'
        ? 'Choose which GA4 property and Search Console site belong to this client.'
        : 'Choose which Google Business Profile location belongs to this client.';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-5">
                <div>
                    <h2 className="text-lg font-semibold">{title}</h2>
                    <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
                </div>

                {loading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Fetching your Google account data…
                    </div>
                )}

                {error && (
                    <div className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        {error}
                    </div>
                )}

                {!loading && !error && group === 'ga4-gsc' && (
                    <div className="space-y-5">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Google Analytics 4 Property</label>
                            <PickerList
                                items={ga4Properties}
                                selected={selectedGA4}
                                onSelect={(id) => {
                                    setSelectedGA4(id);
                                    setSelectedGA4Name(ga4Properties.find(p => p.id === id)?.displayName ?? '');
                                }}
                                getKey={(p) => p.id}
                                renderItem={(p) => (
                                    <>
                                        <div className="font-medium text-foreground">{p.displayName}</div>
                                        <div className="text-xs text-muted-foreground">{p.account} · {p.id.replace('properties/', 'ID: ')}</div>
                                    </>
                                )}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Search Console Site</label>
                            <PickerList
                                items={gscSites}
                                selected={selectedGSC}
                                onSelect={setSelectedGSC}
                                getKey={(s) => s.siteUrl}
                                renderItem={(s) => (
                                    <>
                                        <div className="font-medium text-foreground">{s.siteUrl}</div>
                                        <div className="text-xs text-muted-foreground capitalize">{s.permissionLevel.replace('s', 'S')}</div>
                                    </>
                                )}
                            />
                        </div>
                    </div>
                )}

                {!loading && !error && group === 'gbp' && (
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Business Location</label>
                        <PickerList
                            items={gbpLocations}
                            selected={selectedGBP}
                            onSelect={(name) => {
                                setSelectedGBP(name);
                                const loc = gbpLocations.find(l => l.name === name);
                                if (loc) setSelectedGBPMeta({ title: loc.title, address: loc.address });
                            }}
                            getKey={(l) => l.name}
                            renderItem={(l) => (
                                <>
                                    <div className="font-medium text-foreground">{l.title}</div>
                                    <div className="text-xs text-muted-foreground">{l.address || l.accountName}</div>
                                </>
                            )}
                        />
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
                        disabled={saving || !canSave}
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

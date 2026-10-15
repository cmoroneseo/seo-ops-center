'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';

export interface Ga4KeyEventChoice {
    eventName: string;
}

/**
 * Checkbox list. A null selection means every key event. An empty list is an
 * explicit "none", which the sync stores as no conversion total.
 */
export function Ga4KeyEventOptions({
    events,
    useAll,
    selected,
    onUseAll,
    onToggle,
}: {
    events: Ga4KeyEventChoice[];
    useAll: boolean;
    selected: string[];
    onUseAll: (useAll: boolean) => void;
    onToggle: (eventName: string) => void;
}) {
    return (
        <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
                <input
                    type="checkbox"
                    checked={useAll}
                    onChange={event => onUseAll(event.target.checked)}
                />
                Use all key events
            </label>
            {events.length === 0 ? (
                <p className="text-xs text-muted-foreground">This property has no key events yet.</p>
            ) : (
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {events.map(event => (
                        <label key={event.eventName} className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={useAll || selected.includes(event.eventName)}
                                disabled={useAll}
                                onChange={() => onToggle(event.eventName)}
                            />
                            {event.eventName}
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
}

export function Ga4KeyEventPicker({
    clientId,
    orgId,
    onClose,
    onSaved,
}: {
    clientId: string;
    orgId: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [events, setEvents] = useState<Ga4KeyEventChoice[]>([]);
    const [useAll, setUseAll] = useState(true);
    const [selected, setSelected] = useState<string[]>([]);

    useEffect(() => {
        const params = new URLSearchParams({ clientId, orgId });
        fetch(`/api/integrations/google/ga4/key-events?${params.toString()}`)
            .then(response => response.json())
            .then(data => {
                if (data.error) throw new Error(data.error);
                const listed = Array.isArray(data.events) ? data.events as Ga4KeyEventChoice[] : [];
                setEvents(listed);
                const override = Array.isArray(data.override) ? data.override as string[] : null;
                setUseAll(override == null);
                setSelected(override ?? listed.map(event => event.eventName));
            })
            .catch((err: Error) => setError(err.message || 'Unable to load key events'))
            .finally(() => setLoading(false));
    }, [clientId, orgId]);

    async function save() {
        setSaving(true);
        setError('');
        try {
            const response = await fetch('/api/integrations/google/ga4/key-events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, orgId, keyEvents: useAll ? null : selected }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Unable to save key events');
            onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to save key events');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-5">
                <div>
                    <h2 className="text-lg font-semibold">Key events</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Conversions follow this property&apos;s GA4 key events unless you choose a subset.
                    </p>
                </div>
                {loading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading key events…
                    </div>
                )}
                {error && (
                    <div className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        {error}
                    </div>
                )}
                {!loading && !error && (
                    <Ga4KeyEventOptions
                        events={events}
                        useAll={useAll}
                        selected={selected}
                        onUseAll={setUseAll}
                        onToggle={eventName => {
                            setSelected(current => current.includes(eventName)
                                ? current.filter(name => name !== eventName)
                                : [...current, eventName]);
                        }}
                    />
                )}
                <div className="flex items-center justify-end gap-3">
                    <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-4 py-2">
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={save}
                        disabled={saving || loading || Boolean(error)}
                        className="text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2 disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}

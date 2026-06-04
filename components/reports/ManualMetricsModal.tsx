'use client';

import { useState } from 'react';
import { X, Loader2, Check } from 'lucide-react';
import { ClientProject } from '@/lib/types';

interface Props {
    client: ClientProject;
    orgId: string;
    source: string;
    month: string;
    existingData?: Record<string, any>;
    onClose: () => void;
    onSaved: (data: Record<string, any>) => void;
}

const SOURCE_LABELS: Record<string, string> = {
    ga4: 'Google Analytics 4',
    gsc: 'Google Search Console',
    gbp: 'Google Business Profile',
    ahrefs: 'Ahrefs',
};

// Field definitions per source: key, label, type, placeholder
const FIELDS: Record<string, { key: string; label: string; type: 'number' | 'decimal'; placeholder: string }[]> = {
    ga4: [
        { key: 'sessions', label: 'Total Sessions', type: 'number', placeholder: '4821' },
        { key: 'new_users', label: 'New Users', type: 'number', placeholder: '2103' },
        { key: 'bounce_rate', label: 'Bounce Rate (0–1)', type: 'decimal', placeholder: '0.42' },
        { key: 'organic_sessions', label: 'Organic Sessions', type: 'number', placeholder: '1890' },
    ],
    gsc: [
        { key: 'organic_clicks', label: 'Organic Clicks', type: 'number', placeholder: '1240' },
        { key: 'impressions', label: 'Impressions', type: 'number', placeholder: '18500' },
        { key: 'avg_position', label: 'Avg Position', type: 'decimal', placeholder: '14.2' },
        { key: 'ctr', label: 'CTR (0–1)', type: 'decimal', placeholder: '0.067' },
    ],
    gbp: [
        { key: 'impressions', label: 'GBP Impressions', type: 'number', placeholder: '3200' },
        { key: 'calls', label: 'Calls', type: 'number', placeholder: '48' },
        { key: 'direction_requests', label: 'Direction Requests', type: 'number', placeholder: '31' },
        { key: 'website_clicks', label: 'Website Clicks', type: 'number', placeholder: '112' },
        { key: 'review_count', label: '# of Reviews', type: 'number', placeholder: '87' },
        { key: 'avg_rating', label: 'Avg Rating (1–5)', type: 'decimal', placeholder: '4.6' },
    ],
    ahrefs: [
        { key: 'domain_rating', label: 'Domain Rating', type: 'number', placeholder: '34' },
        { key: 'ranked_keywords', label: 'Ranked Keywords', type: 'number', placeholder: '412' },
        { key: 'top_10_keywords', label: 'Top 10 Keywords', type: 'number', placeholder: '28' },
        { key: 'top_20_keywords', label: 'Top 20 Keywords', type: 'number', placeholder: '67' },
        { key: 'top_50_keywords', label: 'Top 50 Keywords', type: 'number', placeholder: '143' },
    ],
};

export function ManualMetricsModal({ client, orgId, source, month, existingData, onClose, onSaved }: Props) {
    const fields = FIELDS[source] ?? [];
    const monthLabel = new Date(month + '-15').toLocaleString('default', { month: 'long', year: 'numeric' });

    const [values, setValues] = useState<Record<string, string>>(() =>
        Object.fromEntries(fields.map(f => [f.key, existingData?.[f.key] != null ? String(existingData[f.key]) : ''])),
    );
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');

    const handleSave = async () => {
        setSaving(true);
        setError('');

        const data: Record<string, number> = {};
        for (const field of fields) {
            const raw = values[field.key];
            if (raw === '' || raw === undefined) continue;
            const num = Number(raw);
            if (isNaN(num)) {
                setError(`"${field.label}" must be a number.`);
                setSaving(false);
                return;
            }
            data[field.key] = num;
        }

        if (Object.keys(data).length === 0) {
            setError('Please enter at least one value.');
            setSaving(false);
            return;
        }

        const res = await fetch('/api/metrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: client.id, orgId, source, metricMonth: month, data }),
        });

        setSaving(false);
        if (!res.ok) {
            const d = await res.json();
            setError(d.error ?? 'Save failed.');
            return;
        }

        setSaved(true);
        setTimeout(() => onSaved(data), 600);
    };

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md">
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
                        <div>
                            <h2 className="text-base font-semibold">Enter {SOURCE_LABELS[source]} Metrics</h2>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {client.clientName} · {monthLabel}
                            </p>
                        </div>
                        <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    {/* Fields */}
                    <div className="px-6 py-5 space-y-4">
                        {existingData && (
                            <div className="text-xs text-muted-foreground bg-muted/30 border border-border/40 rounded-lg px-3 py-2">
                                Editing existing manual entry — leave fields blank to keep current values.
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                            {fields.map(field => (
                                <div key={field.key} className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">{field.label}</label>
                                    <input
                                        type="number"
                                        step={field.type === 'decimal' ? '0.001' : '1'}
                                        min="0"
                                        value={values[field.key]}
                                        onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                                        placeholder={field.placeholder}
                                        className="w-full px-2.5 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                                    />
                                </div>
                            ))}
                        </div>

                        {error && <p className="text-xs text-red-500">{error}</p>}
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 border-t border-border/50 flex items-center justify-end gap-3">
                        <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors">
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving || saved}
                            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
                        >
                            {saved ? <><Check className="h-3.5 w-3.5" /> Saved!</>
                                : saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                                    : 'Save Metrics'}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

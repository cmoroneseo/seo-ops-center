'use client';

import { useState, useEffect } from 'react';
import { Crosshair, Plus, Check, X, Trash2, Pencil, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { updateCampaignPlan } from '@/lib/supabase/campaign-plans';
import { SectionCard, InlineInput, InlineSelect, CustomFieldSectionProps, KeywordEntry } from './SectionCard';
import { ScreenshotUpload } from './ScreenshotUpload';

const PRIORITY_OPTIONS = [
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
];

const PRIORITY_COLORS: Record<string, string> = {
    high: 'bg-red-500/10 text-red-500 border-red-500/20',
    medium: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    low: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

export function KeywordSnapshotSection({ plan, expanded, onToggle, onRefresh, clientId }: CustomFieldSectionProps & { clientId?: string }) {
    const snapshot = (plan.customFields.keywordSnapshot ?? {}) as { keywords?: KeywordEntry[]; screenshots?: { url: string; caption: string; addedAt: string }[] };
    const [keywords, setKeywords] = useState<KeywordEntry[]>(snapshot.keywords ?? []);
    const [screenshots, setScreenshots] = useState(snapshot.screenshots ?? []);
    const [pulling, setPulling] = useState(false);
    const [pullError, setPullError] = useState('');

    const handleAhrefsPull = async () => {
        if (!clientId) return;
        setPulling(true);
        setPullError('');
        try {
            const res = await fetch(`/api/campaign/keyword-research?clientId=${clientId}`);
            if (!res.ok) {
                const err = await res.json();
                setPullError(err.error || 'Failed to fetch keywords');
                return;
            }
            const data = await res.json();
            const pulled: KeywordEntry[] = (data.keywords ?? []).map((k: any) => ({
                keyword: k.keyword,
                volume: k.volume,
                difficulty: k.difficulty,
                priority: k.difficulty <= 30 ? 'high' as const : k.difficulty <= 60 ? 'medium' as const : 'low' as const,
                cluster: undefined,
            }));
            const merged = [...keywords];
            const existingSet = new Set(keywords.map(k => k.keyword.toLowerCase()));
            for (const kw of pulled) {
                if (!existingSet.has(kw.keyword.toLowerCase())) {
                    merged.push(kw);
                }
            }
            await saveAll(merged, screenshots);
        } catch (err: any) {
            setPullError(err.message || 'Network error');
        } finally {
            setPulling(false);
        }
    };
    const [adding, setAdding] = useState(false);
    const [editingIdx, setEditingIdx] = useState<number | null>(null);
    const [form, setForm] = useState({ keyword: '', volume: '', difficulty: '', priority: '', cluster: '' });

    useEffect(() => {
        const snap = (plan.customFields.keywordSnapshot ?? {}) as { keywords?: KeywordEntry[]; screenshots?: { url: string; caption: string; addedAt: string }[] };
        setKeywords(snap.keywords ?? []);
        setScreenshots(snap.screenshots ?? []);
    }, [plan.customFields.keywordSnapshot]);

    const saveAll = async (updatedKeywords: KeywordEntry[], updatedScreenshots: typeof screenshots) => {
        setKeywords(updatedKeywords);
        setScreenshots(updatedScreenshots);
        await updateCampaignPlan(plan.id, {
            customFields: { ...plan.customFields, keywordSnapshot: { keywords: updatedKeywords, screenshots: updatedScreenshots } },
        });
        onRefresh();
    };

    const saveKeywords = async (updated: KeywordEntry[]) => saveAll(updated, screenshots);

    const startAdd = () => {
        setForm({ keyword: '', volume: '', difficulty: '', priority: '', cluster: '' });
        setAdding(true);
    };

    const startEdit = (idx: number) => {
        const k = keywords[idx];
        setEditingIdx(idx);
        setForm({
            keyword: k.keyword,
            volume: k.volume != null ? String(k.volume) : '',
            difficulty: k.difficulty != null ? String(k.difficulty) : '',
            priority: k.priority ?? '',
            cluster: k.cluster ?? '',
        });
    };

    const handleAdd = async () => {
        if (!form.keyword.trim()) return;
        const entry: KeywordEntry = {
            keyword: form.keyword.trim(),
            volume: form.volume ? Number(form.volume) : undefined,
            difficulty: form.difficulty ? Number(form.difficulty) : undefined,
            priority: (form.priority as KeywordEntry['priority']) || undefined,
            cluster: form.cluster.trim() || undefined,
        };
        await saveKeywords([...keywords, entry]);
        setForm({ keyword: '', volume: '', difficulty: '', priority: '', cluster: '' });
        setAdding(false);
    };

    const handleSave = async (idx: number) => {
        if (!form.keyword.trim()) return;
        const updated = [...keywords];
        updated[idx] = {
            keyword: form.keyword.trim(),
            volume: form.volume ? Number(form.volume) : undefined,
            difficulty: form.difficulty ? Number(form.difficulty) : undefined,
            priority: (form.priority as KeywordEntry['priority']) || undefined,
            cluster: form.cluster.trim() || undefined,
        };
        await saveKeywords(updated);
        setEditingIdx(null);
    };

    const handleDelete = async (idx: number) => {
        const updated = keywords.filter((_, i) => i !== idx);
        await saveKeywords(updated);
    };

    const renderForm = (onSave: () => void, onCancel: () => void) => (
        <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-primary/30">
            <div className="flex items-center gap-2">
                <InlineInput value={form.keyword} onChange={v => setForm(f => ({ ...f, keyword: v }))} placeholder="Keyword…" className="flex-1" />
                <input type="number" value={form.volume} onChange={e => setForm(f => ({ ...f, volume: e.target.value }))} placeholder="Volume" className="bg-transparent border border-border/50 rounded-md text-xs py-1 px-2 w-24 outline-none focus:border-primary" />
                <input type="number" value={form.difficulty} onChange={e => setForm(f => ({ ...f, difficulty: e.target.value }))} placeholder="KD (0-100)" className="bg-transparent border border-border/50 rounded-md text-xs py-1 px-2 w-24 outline-none focus:border-primary" />
            </div>
            <div className="flex items-center gap-2">
                <InlineSelect value={form.priority} onChange={v => setForm(f => ({ ...f, priority: v }))} options={PRIORITY_OPTIONS} />
                <InlineInput value={form.cluster} onChange={v => setForm(f => ({ ...f, cluster: v }))} placeholder="Cluster…" className="flex-1" />
                <button onClick={onSave} className="text-green-500 hover:text-green-400 p-1"><Check className="h-4 w-4" /></button>
                <button onClick={onCancel} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
            </div>
        </div>
    );

    return (
        <SectionCard
            icon={Crosshair} title="Keyword Opportunities" count={keywords.length + screenshots.length}
            expanded={expanded} onToggle={onToggle} onAdd={startAdd}
        >
            {/* Ahrefs pull */}
            <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Keywords to track and target throughout the campaign.</p>
                {clientId && (
                    <button
                        onClick={handleAhrefsPull}
                        disabled={pulling}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 transition-colors disabled:opacity-50"
                    >
                        {pulling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                        {pulling ? 'Pulling…' : 'Pull from Ahrefs'}
                    </button>
                )}
            </div>
            {pullError && (
                <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                    {pullError}
                </div>
            )}

            <ScreenshotUpload
                screenshots={screenshots}
                onUpdate={(updated) => saveAll(keywords, updated)}
                label="Keyword Research Screenshots"
            />

            {screenshots.length > 0 && keywords.length === 0 && !adding && (
                <div className="border-t border-border/30 pt-3" />
            )}

            {keywords.length === 0 && !adding && (
                <p className="text-xs text-muted-foreground italic">No keyword opportunities added yet. Click + Add to enter target keywords for rank tracking.</p>
            )}
            <div className="space-y-2">
                {keywords.map((k, idx) => editingIdx === idx ? (
                    <div key={idx}>
                        {renderForm(() => handleSave(idx), () => setEditingIdx(null))}
                    </div>
                ) : (
                    <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30 group cursor-pointer hover:border-border/60" onClick={() => startEdit(idx)}>
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className="font-medium text-sm truncate">{k.keyword}</span>
                            {k.cluster && (
                                <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full shrink-0">{k.cluster}</span>
                            )}
                            {k.priority && (
                                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full border', PRIORITY_COLORS[k.priority])}>
                                    {k.priority}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                            {k.volume != null && <span>Vol: <strong className="text-foreground">{k.volume.toLocaleString()}</strong></span>}
                            {k.difficulty != null && <span>KD: <strong className="text-foreground">{k.difficulty}</strong></span>}
                            <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 text-muted-foreground transition-all" />
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(idx); }}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            {adding && renderForm(handleAdd, () => setAdding(false))}
        </SectionCard>
    );
}

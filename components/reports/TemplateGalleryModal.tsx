'use client';

// "Start from template" gallery — stock templates + the org's saved templates.

import { useEffect, useState } from 'react';
import { X, FileText, Star, Trash2, Loader2 } from 'lucide-react';
import { STOCK_TEMPLATES } from '@/lib/reports/reportTemplates';
import { blockLabel, Block } from '@/lib/reports/blocks';
import { cn } from '@/lib/utils';

interface CustomTemplate {
    id: string;
    name: string;
    blocks: { type: string; props: Record<string, any> }[];
}

interface Props {
    orgId: string;
    clientName: string;
    monthLabel: string;
    creating: boolean;
    onClose: () => void;
    onPick: (blocks: { type: string; props?: Record<string, any> }[]) => void;
}

export function TemplateGalleryModal({ orgId, clientName, monthLabel, creating, onClose, onPick }: Props) {
    const [custom, setCustom] = useState<CustomTemplate[]>([]);
    const [pickedKey, setPickedKey] = useState<string | null>(null);

    useEffect(() => {
        fetch(`/api/report-templates?orgId=${orgId}`)
            .then(r => r.json())
            .then(d => setCustom(d.templates ?? []))
            .catch(() => setCustom([]));
    }, [orgId]);

    const deleteCustom = async (id: string) => {
        await fetch(`/api/report-templates?id=${id}`, { method: 'DELETE' });
        setCustom(prev => prev.filter(t => t.id !== id));
    };

    const pick = (key: string, blocks: { type: string; props?: Record<string, any> }[]) => {
        if (creating) return;
        setPickedKey(key);
        onPick(blocks);
    };

    const cardCls = 'group relative text-left border border-border/60 rounded-xl p-4 hover:border-primary/50 hover:bg-muted/40 transition-colors cursor-pointer';

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
            <div className="fixed inset-x-0 top-[8vh] z-50 mx-auto w-[min(880px,92vw)] max-h-[84vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div>
                        <h3 className="font-semibold">Build {monthLabel} Report</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{clientName} — pick a starting template</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted"><X className="h-4 w-4" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Start from template</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {STOCK_TEMPLATES.map(t => (
                                <div key={t.key} onClick={() => pick(t.key, t.build())} className={cardCls}>
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <FileText className="h-4 w-4 text-primary" />
                                        <p className="text-sm font-semibold">{t.name}</p>
                                        {creating && pickedKey === t.key && <Loader2 className="h-3.5 w-3.5 animate-spin ml-auto" />}
                                    </div>
                                    <p className="text-xs text-muted-foreground mb-2">{t.description}</p>
                                    <ol className="text-[11px] text-muted-foreground/80 space-y-0.5 list-decimal list-inside">
                                        {t.outline.slice(0, 6).map(s => <li key={s} className="truncate">{s}</li>)}
                                        {t.outline.length > 6 && <li className="list-none">…</li>}
                                    </ol>
                                </div>
                            ))}
                        </div>
                    </div>

                    {custom.length > 0 && (
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1.5">
                                <Star className="h-3.5 w-3.5" /> My templates
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {custom.map(t => (
                                    <div key={t.id} onClick={() => pick(t.id, t.blocks)} className={cardCls}>
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <Star className="h-4 w-4 text-amber-400" />
                                            <p className="text-sm font-semibold truncate">{t.name}</p>
                                            {creating && pickedKey === t.id && <Loader2 className="h-3.5 w-3.5 animate-spin ml-auto" />}
                                        </div>
                                        <ol className="text-[11px] text-muted-foreground/80 space-y-0.5 list-decimal list-inside">
                                            {t.blocks.slice(0, 6).map((b, i) => (
                                                <li key={i} className="truncate">{blockLabel({ id: String(i), type: b.type as Block['type'], props: b.props ?? {} })}</li>
                                            ))}
                                            {t.blocks.length > 6 && <li className="list-none">…</li>}
                                        </ol>
                                        <button
                                            onClick={e => { e.stopPropagation(); deleteCustom(t.id); }}
                                            className={cn('absolute top-3 right-3 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted', 'opacity-0 group-hover:opacity-100 transition-opacity')}>
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

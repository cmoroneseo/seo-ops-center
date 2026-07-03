'use client';

// Inline "Start from template" gallery (SE Ranking pattern: cards on the
// page itself, not a modal). Stock templates + the org's saved templates.
// Clicking a card creates the report immediately.

import { useEffect, useState } from 'react';
import { FileText, Star, Trash2, Loader2 } from 'lucide-react';
import { STOCK_TEMPLATES } from '@/lib/reports/reportTemplates';
import { blockLabel, Block } from '@/lib/reports/blocks';
import { cn } from '@/lib/utils';

export interface CustomTemplate {
    id: string;
    name: string;
    blocks: { type: string; props: Record<string, any> }[];
}

interface Props {
    orgId: string;
    disabled: boolean;
    creating: boolean;
    onPick: (blocks: { type: string; props?: Record<string, any> }[]) => void;
    /** Lifted so the Templates tab can reuse the same fetched list. */
    customTemplates: CustomTemplate[];
    onDeleteCustom: (id: string) => void;
}

export function TemplateGallery({ orgId, disabled, creating, onPick, customTemplates, onDeleteCustom }: Props) {
    const [pickedKey, setPickedKey] = useState<string | null>(null);

    const pick = (key: string, blocks: { type: string; props?: Record<string, any> }[]) => {
        if (creating || disabled) return;
        setPickedKey(key);
        onPick(blocks);
    };

    const cardCls = (isDisabled: boolean) => cn(
        'group relative text-left border border-border/60 rounded-xl p-4 transition-colors shrink-0 w-56',
        isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary/50 hover:bg-muted/40 cursor-pointer',
    );

    return (
        <div className="space-y-5">
            <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Start from template</p>
                <div className="flex gap-3 overflow-x-auto pb-1">
                    {STOCK_TEMPLATES.map(t => (
                        <div key={t.key} onClick={() => pick(t.key, t.build())} className={cardCls(disabled)}>
                            <div className="flex items-center gap-2 mb-1.5">
                                <FileText className="h-4 w-4 text-primary shrink-0" />
                                <p className="text-sm font-semibold truncate">{t.name}</p>
                                {creating && pickedKey === t.key && <Loader2 className="h-3.5 w-3.5 animate-spin ml-auto shrink-0" />}
                            </div>
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                                <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{t.description}</p>
                                <ol className="text-[11px] text-muted-foreground/80 space-y-0.5 list-decimal list-inside">
                                    {t.outline.slice(0, 4).map(s => <li key={s} className="truncate">{s}</li>)}
                                    {t.outline.length > 4 && <li className="list-none">…</li>}
                                </ol>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {customTemplates.length > 0 && (
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1.5">
                        <Star className="h-3.5 w-3.5" /> My templates
                    </p>
                    <div className="flex gap-3 overflow-x-auto pb-1">
                        {customTemplates.map(t => (
                            <div key={t.id} onClick={() => pick(t.id, t.blocks)} className={cardCls(disabled)}>
                                <div className="flex items-center gap-2 mb-1.5">
                                    <Star className="h-4 w-4 text-amber-400 shrink-0" />
                                    <p className="text-sm font-semibold truncate">{t.name}</p>
                                    {creating && pickedKey === t.id && <Loader2 className="h-3.5 w-3.5 animate-spin ml-auto shrink-0" />}
                                </div>
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                                    <ol className="text-[11px] text-muted-foreground/80 space-y-0.5 list-decimal list-inside">
                                        {t.blocks.slice(0, 4).map((b, i) => (
                                            <li key={i} className="truncate">{blockLabel({ id: String(i), type: b.type as Block['type'], props: b.props ?? {} })}</li>
                                        ))}
                                        {t.blocks.length > 4 && <li className="list-none">…</li>}
                                    </ol>
                                </div>
                                <button
                                    onClick={e => { e.stopPropagation(); onDeleteCustom(t.id); }}
                                    className="absolute top-3 right-3 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-card opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

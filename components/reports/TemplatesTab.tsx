'use client';

// "Templates" tab: manage saved custom templates, and browse stock ones read-only.

import { FileText, Star, Trash2 } from 'lucide-react';
import { STOCK_TEMPLATES } from '@/lib/reports/reportTemplates';
import { blockLabel, Block } from '@/lib/reports/blocks';
import { CustomTemplate } from './TemplateGallery';

interface Props {
    customTemplates: CustomTemplate[];
    onDeleteCustom: (id: string) => void;
}

export function TemplatesTab({ customTemplates, onDeleteCustom }: Props) {
    return (
        <div className="space-y-8">
            <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                    <Star className="h-4 w-4" /> My Templates
                </h3>
                {customTemplates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No saved templates yet. Open any report and use “Save as template” in the Settings tab to add one here.
                    </p>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {customTemplates.map(t => (
                            <div key={t.id} className="group relative border border-border/60 rounded-xl p-4 bg-card">
                                <div className="flex items-center gap-2 mb-1.5">
                                    <Star className="h-4 w-4 text-amber-400 shrink-0" />
                                    <p className="text-sm font-semibold truncate">{t.name}</p>
                                </div>
                                <ol className="text-[11px] text-muted-foreground/80 space-y-0.5 list-decimal list-inside">
                                    {t.blocks.slice(0, 6).map((b, i) => (
                                        <li key={i} className="truncate">{blockLabel({ id: String(i), type: b.type as Block['type'], props: b.props ?? {} })}</li>
                                    ))}
                                    {t.blocks.length > 6 && <li className="list-none">…</li>}
                                </ol>
                                <button
                                    onClick={() => onDeleteCustom(t.id)}
                                    className="absolute top-3 right-3 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4" /> Stock Templates
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {STOCK_TEMPLATES.map(t => (
                        <div key={t.key} className="border border-border/60 rounded-xl p-4 bg-card">
                            <div className="flex items-center gap-2 mb-1.5">
                                <FileText className="h-4 w-4 text-primary shrink-0" />
                                <p className="text-sm font-semibold truncate">{t.name}</p>
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
        </div>
    );
}

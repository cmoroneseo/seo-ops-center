'use client';

// Report Builder v2 — SE Ranking-style two-pane editor.
// Left: Sections (widget library) | Formatting | Settings tabs.
// Right: live white-page canvas that doubles as the print/PDF output.

import { useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
    ArrowLeft, Download, Search, Plus, ChevronUp, ChevronDown,
    Trash2, Eye, EyeOff, LayoutGrid, Type, Settings2, BookmarkPlus, Check,
} from 'lucide-react';
import { ClientProject } from '@/lib/types';
import { monthLabel, ReportSourceKey } from '@/lib/reports/sections';
import {
    Block, ReportSectionsField, resolveBlocks, makeBlock, blockLabel,
    WIDGET_LIBRARY, FORMATTING_ITEMS,
} from '@/lib/reports/blocks';
import { RenderBlock, ReportContext, MetricMap, HistoryMap } from './ReportBlocks';
import { cn } from '@/lib/utils';

interface ReportData {
    id: string;
    title: string;
    report_month: string;
    executive_summary: string | null;
    recommendations: string | null;
    sections: ReportSectionsField;
    status: 'draft' | 'published';
}

interface Props {
    client: ClientProject;
    initialReport: ReportData;
    metrics: { current: MetricMap; previous: MetricMap };
    history: HistoryMap;
    organizationId: string;
}

type PanelTab = 'sections' | 'formatting' | 'settings';

export function ReportBuilder({ client, initialReport, metrics, history, organizationId }: Props) {
    const router = useRouter();
    const [blocks, setBlocks] = useState<Block[]>(() => resolveBlocks(initialReport.sections));
    const [title, setTitle] = useState(initialReport.title);
    const [summary, setSummary] = useState(initialReport.executive_summary ?? '');
    const [recs, setRecs] = useState(initialReport.recommendations ?? '');
    const [tab, setTab] = useState<PanelTab>('sections');
    const [query, setQuery] = useState('');
    const [hideEmpty, setHideEmpty] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
    const [templateSaved, setTemplateSaved] = useState(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Persistence ───────────────────────────────────────────────────────────
    const save = useCallback(async (patch: Record<string, unknown>) => {
        setSaveState('saving');
        await fetch(`/api/reports/${initialReport.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1500);
    }, [initialReport.id]);

    const queueSave = useCallback((patch: Record<string, unknown>) => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => save(patch), 700);
    }, [save]);

    const commitBlocks = (next: Block[]) => {
        setBlocks(next);
        queueSave({ sections: { version: 2, blocks: next } });
    };

    // ── Block operations ──────────────────────────────────────────────────────
    const addBlock = (type: Block['type'], props: Record<string, any>) => {
        const block = makeBlock(type, { ...props });
        commitBlocks([...blocks, block]);
        setSelectedId(block.id);
        // Scroll new block into view after render
        setTimeout(() => document.getElementById(`block-${block.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    };

    const removeBlock = (id: string) => commitBlocks(blocks.filter(b => b.id !== id));

    const moveBlock = (id: string, dir: -1 | 1) => {
        const i = blocks.findIndex(b => b.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= blocks.length) return;
        const next = [...blocks];
        [next[i], next[j]] = [next[j], next[i]];
        commitBlocks(next);
    };

    const editBlockProps = (id: string, patch: Record<string, any>) => {
        commitBlocks(blocks.map(b => b.id === id ? { ...b, props: { ...b.props, ...patch } } : b));
    };

    const editField = (field: 'executive_summary' | 'recommendations', value: string) => {
        if (field === 'executive_summary') setSummary(value); else setRecs(value);
        queueSave({ [field]: value });
    };

    // ── Save current layout as a reusable org template ────────────────────────
    const saveAsTemplate = async () => {
        const name = window.prompt('Template name:', `${title.replace(client.clientName, '').trim() || 'My template'}`);
        if (!name) return;
        // Strip client-bound text content; keep structure + bound fields
        const templateBlocks = blocks.map(b => ({ type: b.type, props: { ...b.props } }));
        const res = await fetch('/api/report-templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orgId: organizationId, name, blocks: templateBlocks }),
        });
        if (res.ok) {
            setTemplateSaved(true);
            setTimeout(() => setTemplateSaved(false), 2000);
        }
    };

    const downloadPDF = () => window.print();

    // ── Canvas: split blocks into pages on page_break ─────────────────────────
    const pages = useMemo(() => {
        const out: Block[][] = [[]];
        for (const b of blocks) {
            if (b.type === 'page_break') out.push([]);
            else out[out.length - 1].push(b);
        }
        return out.filter((p, i) => p.length > 0 || i === 0);
    }, [blocks]);

    const ctx: ReportContext = {
        client,
        reportMonth: initialReport.report_month,
        executiveSummary: summary,
        recommendations: recs,
        metrics, history, hideEmpty,
        onEditText: editBlockProps,
        onEditField: editField,
    };

    const hasData = (source: ReportSourceKey) =>
        !!metrics.current[source] && Object.keys(metrics.current[source]!).length > 0;

    const q = query.trim().toLowerCase();
    const filteredLibrary = WIDGET_LIBRARY
        .map(g => ({ ...g, items: g.items.filter(it => !q || it.name.toLowerCase().includes(q) || it.description.toLowerCase().includes(q)) }))
        .filter(g => g.items.length > 0);

    // Index of each block within the full blocks array (for move up/down across pages)
    const blockIndex = (id: string) => blocks.findIndex(b => b.id === id);

    return (
        <div className="min-h-screen flex flex-col">
            {/* Print CSS: only the canvas pages print */}
            <style>{`
                @media print {
                    body * { visibility: hidden; }
                    #report-print-area, #report-print-area * { visibility: visible; }
                    #report-print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; background: white !important; }
                    .report-page { box-shadow: none !important; border: none !important; border-radius: 0 !important; margin: 0 0 24px !important; break-after: page; }
                    .print-hidden { display: none !important; }
                    @page { margin: 14mm; }
                }
            `}</style>

            {/* Top bar */}
            <div className="print-hidden sticky top-0 z-30 flex items-center justify-between gap-3 bg-card/95 backdrop-blur border-b border-border px-5 py-3">
                <div className="flex items-center gap-3 min-w-0">
                    <button onClick={() => router.push('/reports')} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    <div className="min-w-0">
                        <input
                            value={title}
                            onChange={e => { setTitle(e.target.value); queueSave({ title: e.target.value }); }}
                            className="text-sm font-semibold bg-transparent focus:outline-none focus:border-b focus:border-primary w-72 truncate"
                        />
                        <p className="text-xs text-muted-foreground">{client.clientName} · {monthLabel(initialReport.report_month)}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-14 text-right">
                        {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : ''}
                    </span>
                    <button onClick={downloadPDF} className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground rounded-lg px-3 py-1.5 hover:bg-primary/90">
                        <Download className="h-3.5 w-3.5" /> Download PDF
                    </button>
                </div>
            </div>

            <div className="flex flex-1 min-h-0">
                {/* ── Left panel ──────────────────────────────────────────────── */}
                <aside className="print-hidden w-80 shrink-0 border-r border-border flex flex-col sticky top-[53px] self-start h-[calc(100vh-53px)]">
                    {/* Tabs */}
                    <div className="flex border-b border-border">
                        {([
                            ['sections', 'Sections', LayoutGrid],
                            ['formatting', 'Formatting', Type],
                            ['settings', 'Settings', Settings2],
                        ] as [PanelTab, string, typeof LayoutGrid][]).map(([key, label, Icon]) => (
                            <button key={key} onClick={() => setTab(key)}
                                className={cn(
                                    'flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-3 border-b-2 -mb-px transition-colors',
                                    tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                                )}>
                                <Icon className="h-3.5 w-3.5" /> {label}
                            </button>
                        ))}
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {tab === 'sections' && (
                            <div className="p-4 space-y-4">
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                                    <input
                                        value={query} onChange={e => setQuery(e.target.value)}
                                        placeholder="Search by name"
                                        className="w-full text-sm bg-muted/40 border border-border rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                                    />
                                </div>
                                {filteredLibrary.map(group => (
                                    <div key={group.name}>
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.name}</p>
                                            {!hasData(group.source) && (
                                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">no data</span>
                                            )}
                                        </div>
                                        <div className="space-y-1">
                                            {group.items.map(item => (
                                                <button key={item.key} onClick={() => addBlock(item.type, item.props)}
                                                    className="w-full group flex items-start gap-2 text-left px-3 py-2 rounded-lg hover:bg-muted transition-colors">
                                                    <Plus className="h-3.5 w-3.5 mt-0.5 text-muted-foreground group-hover:text-primary shrink-0" />
                                                    <span>
                                                        <span className="block text-sm">{item.name}</span>
                                                        <span className="block text-xs text-muted-foreground">{item.description}</span>
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {tab === 'formatting' && (
                            <div className="p-4 space-y-1">
                                {FORMATTING_ITEMS.map(item => (
                                    <button key={item.key} onClick={() => addBlock(item.type, item.props)}
                                        className="w-full group flex items-start gap-2 text-left px-3 py-2 rounded-lg hover:bg-muted transition-colors">
                                        <Plus className="h-3.5 w-3.5 mt-0.5 text-muted-foreground group-hover:text-primary shrink-0" />
                                        <span>
                                            <span className="block text-sm">{item.name}</span>
                                            <span className="block text-xs text-muted-foreground">{item.description}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {tab === 'settings' && (
                            <div className="p-4 space-y-5">
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Report title</label>
                                    <input
                                        value={title}
                                        onChange={e => { setTitle(e.target.value); queueSave({ title: e.target.value }); }}
                                        className="mt-1 w-full text-sm bg-muted/40 border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm">Hide empty widgets</p>
                                        <p className="text-xs text-muted-foreground">Skip sections with no data</p>
                                    </div>
                                    <button onClick={() => setHideEmpty(v => !v)}
                                        className={cn('relative h-5 w-9 rounded-full transition-colors shrink-0', hideEmpty ? 'bg-primary' : 'bg-muted')}>
                                        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', hideEmpty ? 'left-[18px]' : 'left-0.5')} />
                                    </button>
                                </div>
                                <div className="pt-1 border-t border-border">
                                    <button onClick={saveAsTemplate}
                                        className="w-full flex items-center justify-center gap-2 text-sm border border-border rounded-lg px-3 py-2 hover:bg-muted transition-colors">
                                        {templateSaved ? <><Check className="h-4 w-4 text-green-500" /> Saved to My templates</> : <><BookmarkPlus className="h-4 w-4" /> Save as template</>}
                                    </button>
                                    <p className="text-xs text-muted-foreground mt-2">Saves this layout to “My templates” for reuse on any client.</p>
                                </div>
                                <div className="text-xs text-muted-foreground space-y-1 pt-1 border-t border-border">
                                    <p><span className="font-medium text-foreground">Client:</span> {client.clientName}</p>
                                    <p><span className="font-medium text-foreground">Period:</span> {monthLabel(initialReport.report_month)}</p>
                                    <p><span className="font-medium text-foreground">Export:</span> PDF (print dialog → Save as PDF)</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Panel footer: quick toggle mirrored from settings */}
                    <div className="print-hidden border-t border-border px-4 py-2.5 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">{blocks.length} block{blocks.length === 1 ? '' : 's'}</span>
                        <button onClick={() => setHideEmpty(v => !v)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                            {hideEmpty ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            {hideEmpty ? 'Hiding empty' : 'Showing all'}
                        </button>
                    </div>
                </aside>

                {/* ── Canvas ──────────────────────────────────────────────────── */}
                <main className="flex-1 bg-muted/30 overflow-y-auto">
                    <div id="report-print-area" className="max-w-[860px] mx-auto px-6 py-8 space-y-6">
                        {pages.map((page, pi) => (
                            <div key={pi} className="report-page bg-white rounded-xl shadow-lg border border-border/40 px-10 py-9 space-y-7">
                                {page.length === 0 && (
                                    <p className="text-sm italic text-center py-16 print-hidden" style={{ color: '#9ca3af' }}>
                                        Empty page — add sections from the left panel.
                                    </p>
                                )}
                                {page.map(block => {
                                    const idx = blockIndex(block.id);
                                    return (
                                        <div key={block.id} id={`block-${block.id}`}
                                            onClick={() => setSelectedId(block.id)}
                                            className={cn(
                                                'relative group/block rounded-lg -mx-3 px-3 py-1 transition-shadow',
                                                selectedId === block.id && 'ring-2 ring-primary/30',
                                            )}
                                            style={{ breakInside: 'avoid' }}>
                                            {/* Hover toolbar */}
                                            <div className={cn(
                                                'print-hidden absolute -top-3 right-2 z-10 items-center gap-0.5 bg-card border border-border rounded-lg shadow-sm px-1 py-0.5',
                                                selectedId === block.id ? 'flex' : 'hidden group-hover/block:flex',
                                            )}>
                                                <span className="text-[10px] text-muted-foreground px-1.5 max-w-40 truncate">{blockLabel(block)}</span>
                                                <button disabled={idx === 0} onClick={e => { e.stopPropagation(); moveBlock(block.id, -1); }}
                                                    className="p-1 rounded hover:bg-muted disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
                                                <button disabled={idx === blocks.length - 1} onClick={e => { e.stopPropagation(); moveBlock(block.id, 1); }}
                                                    className="p-1 rounded hover:bg-muted disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
                                                <button onClick={e => { e.stopPropagation(); removeBlock(block.id); }}
                                                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                                            </div>
                                            <RenderBlock block={block} ctx={ctx} />
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </main>
            </div>
        </div>
    );
}

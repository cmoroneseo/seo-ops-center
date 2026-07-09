'use client';

// Report Builder v2 — SE Ranking-style two-pane editor.
// Left: Sections (widget library) | Formatting | Settings tabs.
// Right: live white-page canvas that doubles as the print/PDF output.

import { useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
    ArrowLeft, Download, Search, Plus, ChevronUp, ChevronDown, ChevronRight,
    Trash2, Eye, EyeOff, LayoutGrid, Type, Settings2, BookmarkPlus, Check,
    RefreshCw, Pencil, AlertCircle, CheckCircle2, BarChart3, Database, Folder,
} from 'lucide-react';
import { ClientProject } from '@/lib/types';
import { useClients } from '@/lib/hooks/use-clients';
import { REPORT_SECTIONS, monthLabel, ReportSourceKey } from '@/lib/reports/sections';
import {
    Block, ReportSectionsField, resolveBlocks, makeBlock, blockLabel,
    WIDGET_LIBRARY, FORMATTING_ITEMS,
} from '@/lib/reports/blocks';
import { RenderBlock, ReportContext, MetricMap, HistoryMap } from './ReportBlocks';
import { ManualMetricsModal } from './ManualMetricsModal';
import { cn } from '@/lib/utils';

interface ReportData {
    id: string;
    client_id: string;
    title: string;
    report_month: string;
    executive_summary: string | null;
    recommendations: string | null;
    sections: ReportSectionsField;
    status: 'draft' | 'published';
}

interface Props {
    /** Null when the report has no client assigned yet — canvas stays blank
     *  until one is picked via the Settings tab's Bulk parameters. */
    client: ClientProject | null;
    initialReport: ReportData;
    metrics: { current: MetricMap; previous: MetricMap };
    history: HistoryMap;
    organizationId: string;
    /** Called after the client or report period is reassigned, so the parent
     *  page can refetch metrics/history scoped to the new client+month. */
    onDataChanged?: () => void;
}

type PanelTab = 'sections' | 'formatting' | 'settings';

const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
});

export function ReportBuilder({ client, initialReport, metrics, history, organizationId, onDataChanged }: Props) {
    const router = useRouter();
    const [blocks, setBlocks] = useState<Block[]>(() => resolveBlocks(initialReport.sections));
    const [title, setTitle] = useState(initialReport.title);
    const [summary, setSummary] = useState(initialReport.executive_summary ?? '');
    const [recs, setRecs] = useState(initialReport.recommendations ?? '');
    // Unassigned reports open straight to Settings — that's where a client gets picked.
    const [tab, setTab] = useState<PanelTab>(client ? 'sections' : 'settings');
    const [query, setQuery] = useState('');
    const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
    const [hideEmpty, setHideEmpty] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
    const [templateSaved, setTemplateSaved] = useState(false);
    const [reassigning, setReassigning] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState('');
    const [manualSource, setManualSource] = useState<string | null>(null);
    const { clients: activeClients } = useClients({ statuses: ['Active'] });
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
        const name = window.prompt('Template name:', `${title.replace(client?.clientName ?? '', '').trim() || 'My template'}`);
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

    // ── Client / period reassignment (Settings tab) ────────────────────────────
    const reassign = async (patch: { client_id?: string; report_month?: string }) => {
        setReassigning(true);
        await fetch(`/api/reports/${initialReport.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        onDataChanged?.();
        // Parent remounts this component (keyed by client+month) once fresh
        // props arrive, so no local state reset is needed here.
    };

    // ── Data Sources (sync + manual entry), scoped to this report's client/month ──
    const triggerSync = async () => {
        if (!client) return;
        setSyncing(true);
        setSyncResult('');
        try {
            const res = await fetch('/api/sync/metrics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId: client.id, month: initialReport.report_month }),
            });
            const data = await res.json();
            setSyncResult(res.ok
                ? `Sync complete — ${data.errors === 0 ? 'all sources updated' : `${data.errors} source(s) had errors`}`
                : `Sync failed: ${data.error}`);
            if (res.ok) onDataChanged?.();
        } catch (e: any) {
            setSyncResult(`Sync error: ${e.message}`);
        } finally {
            setSyncing(false);
        }
    };

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
                .print-only { display: none; }
                @media print {
                    body * { visibility: hidden; }
                    #report-print-area, #report-print-area * { visibility: visible; }
                    #report-print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; background: white !important; }
                    .report-page { box-shadow: none !important; border: none !important; border-radius: 0 !important; margin: 0 0 24px !important; break-after: page; }
                    .print-hidden { display: none !important; }
                    .print-only { display: block !important; }
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
                        {client ? (
                            <p className="text-xs text-muted-foreground">{client.clientName} · {monthLabel(initialReport.report_month)}</p>
                        ) : (
                            <button onClick={() => setTab('settings')} className="text-xs text-amber-500 hover:underline">
                                No client selected — pick one in Settings
                            </button>
                        )}
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
                            <div className="p-4 space-y-3">
                                {!client && (
                                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-600 dark:text-amber-400">
                                        Select a client in{' '}
                                        <button onClick={() => setTab('settings')} className="font-medium underline">Settings</button>
                                        {' '}before adding data sections — widgets will stay empty until then.
                                    </div>
                                )}
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                                    <input
                                        value={query} onChange={e => setQuery(e.target.value)}
                                        placeholder="Search by name"
                                        className="w-full text-sm bg-muted/40 border border-border rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                                    />
                                </div>
                                {filteredLibrary.map(group => {
                                    const isOpen = query.trim() ? true : openGroups.has(group.name);
                                    return (
                                        <div key={group.name}>
                                            <button
                                                onClick={() => setOpenGroups(prev => {
                                                    const next = new Set(prev);
                                                    next.has(group.name) ? next.delete(group.name) : next.add(group.name);
                                                    return next;
                                                })}
                                                className="w-full flex items-center gap-2 py-1.5 rounded-lg hover:bg-muted/60 transition-colors"
                                            >
                                                <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex-1 text-left">{group.name}</span>
                                                <span className="text-[10px] text-muted-foreground">{group.items.length}</span>
                                                {!hasData(group.source) && (
                                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">no data</span>
                                                )}
                                                {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                            </button>
                                            {isOpen && (
                                                <div className="space-y-1 pl-1 mt-0.5">
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
                                            )}
                                        </div>
                                    );
                                })}
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

                                {/* Bulk parameters — client + period, applied to every widget on this report */}
                                <div className="space-y-3 pb-1 border-b border-border">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bulk parameters</p>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">Client</label>
                                        <select
                                            value={client?.id ?? ''}
                                            disabled={reassigning}
                                            onChange={e => e.target.value && reassign({ client_id: e.target.value })}
                                            className={cn(
                                                'mt-1 w-full text-sm bg-muted/40 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50',
                                                client ? 'border-border' : 'border-amber-500/40',
                                            )}
                                        >
                                            {!client && <option value="" disabled>Select a client…</option>}
                                            {client && !activeClients.some(c => c.id === client.id) && (
                                                <option value={client.id}>{client.clientName}</option>
                                            )}
                                            {activeClients.map(c => <option key={c.id} value={c.id}>{c.clientName}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">Report period</label>
                                        <select
                                            value={initialReport.report_month}
                                            disabled={reassigning}
                                            onChange={e => reassign({ report_month: e.target.value })}
                                            className="mt-1 w-full text-sm bg-muted/40 border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                                        >
                                            {!monthOptions.includes(initialReport.report_month) && (
                                                <option value={initialReport.report_month}>{monthLabel(initialReport.report_month)}</option>
                                            )}
                                            {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                                        </select>
                                    </div>
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

                                {/* Data Sources — sync/manual entry, scoped to this report's client + period */}
                                <div className="pt-1 border-t border-border space-y-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                                        <Database className="h-3.5 w-3.5" /> Data Sources
                                    </p>
                                    {!client ? (
                                        <p className="text-xs text-muted-foreground">Select a client above to sync or enter metrics.</p>
                                    ) : (
                                    <>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            onClick={triggerSync}
                                            disabled={syncing}
                                            className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-muted transition-colors disabled:opacity-50"
                                        >
                                            <RefreshCw className={cn('h-3 w-3', syncing && 'animate-spin')} />
                                            {syncing ? 'Syncing…' : 'Sync Now'}
                                        </button>
                                    </div>
                                    {syncResult && (
                                        <p className={cn(
                                            'flex items-center gap-1.5 text-xs',
                                            syncResult.includes('error') || syncResult.includes('failed') ? 'text-red-500' : 'text-green-500',
                                        )}>
                                            {syncResult.includes('error') || syncResult.includes('failed')
                                                ? <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                                : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                                            {syncResult}
                                        </p>
                                    )}
                                    <div className="space-y-2">
                                        {REPORT_SECTIONS.map(def => {
                                            const cur = metrics.current[def.key];
                                            const hasData = !!cur && Object.keys(cur).length > 0;
                                            return (
                                                <div key={def.key} className="border border-border/60 rounded-lg px-3 py-2">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="flex items-center gap-1.5 text-xs">
                                                            <span>{def.icon}</span> {def.name}
                                                            {hasData && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                                                        </span>
                                                        <button
                                                            onClick={() => setManualSource(def.key)}
                                                            className={cn(
                                                                'flex items-center gap-1 text-[11px] rounded-md px-2 py-1 border transition-colors',
                                                                hasData
                                                                    ? 'text-muted-foreground border-border hover:border-primary/40 hover:text-foreground'
                                                                    : 'bg-primary text-primary-foreground border-primary hover:bg-primary/90',
                                                            )}
                                                        >
                                                            {hasData ? <><Pencil className="h-2.5 w-2.5" /> Edit</> : <><Plus className="h-2.5 w-2.5" /> Enter manually</>}
                                                        </button>
                                                    </div>
                                                    {!hasData && (
                                                        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1.5">
                                                            <BarChart3 className="h-3 w-3" /> No data for {monthLabel(initialReport.report_month)}.
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    </>
                                    )}
                                </div>

                                <p className="text-xs text-muted-foreground pt-1 border-t border-border">Export: PDF (print dialog → Save as PDF)</p>
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

            {manualSource && client && (
                <ManualMetricsModal
                    client={client}
                    orgId={organizationId}
                    source={manualSource}
                    month={initialReport.report_month}
                    existingData={metrics.current[manualSource as ReportSourceKey]}
                    onClose={() => setManualSource(null)}
                    onSaved={() => {
                        setManualSource(null);
                        onDataChanged?.();
                    }}
                />
            )}
        </div>
    );
}

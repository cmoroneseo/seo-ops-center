'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
    ArrowLeft, Settings2, Download, Eye, EyeOff,
    ChevronUp, ChevronDown, X, Sparkles, Pencil,
} from 'lucide-react';
import { ClientProject } from '@/lib/types';
import {
    REPORT_SECTIONS, METRIC_DEFS, formatMetric, monthLabel,
    SectionConfig, ReportSourceKey, defaultSectionConfig,
} from '@/lib/reports/sections';
import { MoMDelta } from './MoMDelta';
import { buildReportHTML } from './buildReportHTML';
import { cn } from '@/lib/utils';

type MetricMap = Partial<Record<ReportSourceKey, Record<string, any>>>;

interface ReportData {
    id: string;
    title: string;
    report_month: string;
    executive_summary: string | null;
    recommendations: string | null;
    sections: SectionConfig[];
    status: 'draft' | 'published';
}

interface Props {
    client: ClientProject;
    initialReport: ReportData;
    metrics: { current: MetricMap; previous: MetricMap };
}

export function ReportBuilder({ client, initialReport, metrics }: Props) {
    const router = useRouter();
    const [summary, setSummary] = useState(initialReport.executive_summary ?? '');
    const [recs, setRecs] = useState(initialReport.recommendations ?? '');
    const [sections, setSections] = useState<SectionConfig[]>(
        initialReport.sections?.length ? initialReport.sections : defaultSectionConfig(),
    );
    const [hideEmpty, setHideEmpty] = useState(true);
    const [showConfig, setShowConfig] = useState(false);
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    const updateSections = (next: SectionConfig[]) => {
        setSections(next);
        save({ sections: next });
    };

    const toggleSection = (key: ReportSourceKey) =>
        updateSections(sections.map(s => s.key === key ? { ...s, enabled: !s.enabled } : s));

    const move = (key: ReportSourceKey, dir: -1 | 1) => {
        const sorted = [...sections].sort((a, b) => a.order - b.order);
        const i = sorted.findIndex(s => s.key === key);
        const j = i + dir;
        if (j < 0 || j >= sorted.length) return;
        [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
        updateSections(sorted.map((s, idx) => ({ ...s, order: idx })));
    };

    const orderedSections = [...sections].sort((a, b) => a.order - b.order);

    const downloadPDF = () => {
        const html = buildReportHTML(client,
            { title: initialReport.title, reportMonth: initialReport.report_month, executiveSummary: summary, recommendations: recs, sections },
            metrics);
        const win = window.open('', '_blank');
        if (!win) return;
        win.document.write(html);
        win.document.close();
        win.focus();
        setTimeout(() => win.print(), 500);
    };

    const initials = client.clientName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const hasData = (key: ReportSourceKey) => metrics.current[key] && Object.keys(metrics.current[key]!).length > 0;

    return (
        <div className="min-h-screen">
            {/* Top bar */}
            <div className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-card/95 backdrop-blur border-b border-border px-5 py-3">
                <div className="flex items-center gap-3 min-w-0">
                    <button onClick={() => router.push('/reports')} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    {client.logoUrl
                        ? <img src={client.logoUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />
                        : <div className="h-9 w-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">{initials}</div>}
                    <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{client.clientName}</p>
                        <p className="text-xs text-muted-foreground">{monthLabel(initialReport.report_month)} SEO Report</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-14 text-right">
                        {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : ''}
                    </span>
                    <button onClick={() => setHideEmpty(v => !v)} className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-muted">
                        {hideEmpty ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {hideEmpty ? 'Hiding empty' : 'Showing all'}
                    </button>
                    <button onClick={() => setShowConfig(true)} className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-muted">
                        <Settings2 className="h-3.5 w-3.5" /> Configure
                    </button>
                    <button onClick={downloadPDF} className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground rounded-lg px-3 py-1.5 hover:bg-primary/90">
                        <Download className="h-3.5 w-3.5" /> Download PDF
                    </button>
                </div>
            </div>

            <div className="flex">
                {/* Section nav */}
                <aside className="hidden lg:block w-52 shrink-0 border-r border-border p-4 sticky top-[57px] self-start">
                    <nav className="space-y-1">
                        <a href="#summary" className="block px-3 py-2 text-sm rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">Executive Summary</a>
                        {orderedSections.filter(s => s.enabled).map(s => {
                            const def = REPORT_SECTIONS.find(d => d.key === s.key)!;
                            const empty = !hasData(s.key);
                            if (hideEmpty && empty) return null;
                            return (
                                <a key={s.key} href={`#${s.key}`} className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
                                    <span>{def.icon}</span> {def.name}
                                </a>
                            );
                        })}
                        <a href="#recs" className="block px-3 py-2 text-sm rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">Recommendations</a>
                    </nav>
                </aside>

                {/* Report body */}
                <main className="flex-1 max-w-4xl mx-auto px-6 py-8 space-y-8">
                    {/* Executive Summary */}
                    <section id="summary" className="scroll-mt-20">
                        <div className="flex items-center gap-2 mb-3">
                            <Sparkles className="h-4 w-4 text-primary" />
                            <h2 className="text-lg font-semibold">Executive Summary</h2>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Pencil className="h-2.5 w-2.5" /> editable</span>
                        </div>
                        <textarea
                            value={summary}
                            onChange={e => { setSummary(e.target.value); queueSave({ executive_summary: e.target.value }); }}
                            rows={4}
                            placeholder="Auto-generated from your metrics — edit to add your insight…"
                            className="w-full text-sm leading-relaxed bg-card border border-border rounded-xl p-4 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                        />
                    </section>

                    {/* Metric sections */}
                    {orderedSections.filter(s => s.enabled).map(s => {
                        const def = REPORT_SECTIONS.find(d => d.key === s.key)!;
                        const cur = metrics.current[s.key];
                        const empty = !cur || Object.keys(cur).length === 0;
                        if (hideEmpty && empty) return null;
                        const prev = metrics.previous[s.key] ?? {};

                        return (
                            <section key={s.key} id={s.key} className="scroll-mt-20">
                                <div className="flex items-center gap-2 border-b-2 border-primary pb-2 mb-4">
                                    <span className="text-lg">{def.icon}</span>
                                    <h2 className="text-lg font-semibold">{def.name}</h2>
                                    <span className="text-xs text-muted-foreground ml-1">{def.blurb}</span>
                                </div>
                                {empty ? (
                                    <p className="text-sm text-muted-foreground italic">No data for this source. Sync or enter it manually on the Reports page.</p>
                                ) : (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                                        {METRIC_DEFS[s.key].map(m => cur![m.key] == null ? null : (
                                            <div key={m.key} className="border border-border/60 rounded-xl p-3.5 bg-card">
                                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.label}</div>
                                                <div className="flex items-baseline gap-1.5 mt-1">
                                                    <span className="text-xl font-bold">{formatMetric(cur![m.key], m.format)}</span>
                                                    <MoMDelta current={cur![m.key]} previous={prev[m.key]} lowerIsBetter={m.lowerIsBetter} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        );
                    })}

                    {/* Recommendations */}
                    <section id="recs" className="scroll-mt-20">
                        <div className="flex items-center gap-2 mb-3">
                            <h2 className="text-lg font-semibold">Recommendations</h2>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Pencil className="h-2.5 w-2.5" /> editable</span>
                        </div>
                        <textarea
                            value={recs}
                            onChange={e => { setRecs(e.target.value); queueSave({ recommendations: e.target.value }); }}
                            rows={5}
                            placeholder="Next steps for the client…"
                            className="w-full text-sm leading-relaxed bg-card border border-border rounded-xl p-4 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                        />
                    </section>
                </main>
            </div>

            {/* Configure slide-over */}
            {showConfig && (
                <>
                    <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setShowConfig(false)} />
                    <div className="fixed right-0 top-0 bottom-0 z-50 w-80 bg-card border-l border-border shadow-2xl flex flex-col">
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                            <h3 className="font-semibold flex items-center gap-2"><Settings2 className="h-4 w-4" /> Configure Report</h3>
                            <button onClick={() => setShowConfig(false)} className="p-1.5 rounded-md hover:bg-muted"><X className="h-4 w-4" /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5 space-y-2">
                            <p className="text-xs text-muted-foreground mb-3">Toggle sections on/off and reorder. Changes save automatically.</p>
                            {orderedSections.map((s, idx) => {
                                const def = REPORT_SECTIONS.find(d => d.key === s.key)!;
                                return (
                                    <div key={s.key} className="flex items-center gap-2 border border-border/60 rounded-lg px-3 py-2">
                                        <span>{def.icon}</span>
                                        <span className="text-sm flex-1">{def.name}</span>
                                        <div className="flex flex-col">
                                            <button disabled={idx === 0} onClick={() => move(s.key, -1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
                                            <button disabled={idx === orderedSections.length - 1} onClick={() => move(s.key, 1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
                                        </div>
                                        <button onClick={() => toggleSection(s.key)} className={cn('relative h-5 w-9 rounded-full transition-colors', s.enabled ? 'bg-primary' : 'bg-muted')}>
                                            <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', s.enabled ? 'left-[18px]' : 'left-0.5')} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

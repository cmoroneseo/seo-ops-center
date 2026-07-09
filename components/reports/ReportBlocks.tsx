'use client';

// Block renderers for the report canvas. Rendered on white "paper" pages that
// double as the print/PDF output, so colors are a fixed light palette rather
// than theme variables.

import { useEffect, useRef, useState } from 'react';
import { Upload, X, Loader2, GripVertical, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import {
    LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { ClientProject } from '@/lib/types';
import {
    METRIC_DEFS, REPORT_SECTIONS, formatMetric, computeDelta,
    monthLabel, ReportSourceKey,
} from '@/lib/reports/sections';
import { Block } from '@/lib/reports/blocks';
import { createClient } from '@/lib/supabase/client';
import type { RankTrackerResult } from '@/lib/sync/fetchAhrefsRankTracker';

const ACCENT = '#ef4444';
const CHART_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981'];

export type MetricMap = Partial<Record<ReportSourceKey, Record<string, any>>>;
export type HistoryMap = Partial<Record<ReportSourceKey, { month: string; data: Record<string, any> }[]>>;

export interface ReportContext {
    reportId: string;
    client: ClientProject | null;
    reportMonth: string;
    executiveSummary: string;
    recommendations: string;
    metrics: { current: MetricMap; previous: MetricMap };
    history: HistoryMap;
    hideEmpty: boolean;
    /** Editing callbacks — undefined in read-only/print contexts. */
    onEditText?: (blockId: string, patch: Record<string, any>) => void;
    onEditField?: (field: 'executive_summary' | 'recommendations', value: string) => void;
}

const METRIC_LABELS: Record<string, string> = Object.fromEntries(
    Object.values(METRIC_DEFS).flat().map(m => [m.key, m.label]),
);

function shortMonth(month: string): string {
    return new Date(month + '-15').toLocaleString('default', { month: 'short', year: '2-digit' });
}

function ordinal(n: number): string {
    const v = n % 100;
    if (v >= 11 && v <= 13) return `${n}th`;
    switch (n % 10) {
        case 1: return `${n}st`;
        case 2: return `${n}nd`;
        case 3: return `${n}rd`;
        default: return `${n}th`;
    }
}

/** 'YYYY-MM' + day-of-month -> "Jun 1st". */
function monthDayOrdinal(month: string, day: number): string {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1, day);
    const monthAbbr = d.toLocaleString('default', { month: 'short' });
    return `${monthAbbr} ${ordinal(day)}`;
}

function lastDayOfMonth(month: string): number {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m, 0).getDate();
}

function EmptyNote({ text }: { text: string }) {
    return <p className="text-sm italic" style={{ color: '#9ca3af' }}>{text}</p>;
}

// ─── Formatting blocks ────────────────────────────────────────────────────────

export function CoverBlock({ ctx }: { ctx: ReportContext }) {
    const { client, reportMonth } = ctx;

    if (!client) {
        return (
            <div className="flex flex-col justify-between" style={{ minHeight: 420 }}>
                <div className="h-2 rounded-full" style={{ background: ACCENT, opacity: 0.3 }} />
                <div className="flex flex-col items-center text-center gap-5 py-10">
                    <div className="h-20 w-20 rounded-2xl border-2 border-dashed flex items-center justify-center" style={{ borderColor: '#d1d5db' }} />
                    <div>
                        <h1 className="text-2xl font-semibold" style={{ color: '#9ca3af' }}>No client selected</h1>
                        <p className="text-sm mt-2" style={{ color: '#9ca3af' }}>Pick a client in Settings to populate this cover.</p>
                        <p className="text-base font-medium mt-1" style={{ color: ACCENT }}>{monthLabel(reportMonth)}</p>
                    </div>
                </div>
                <div />
            </div>
        );
    }

    const initials = client.clientName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return (
        <div className="flex flex-col justify-between" style={{ minHeight: 420 }}>
            <div className="h-2 rounded-full" style={{ background: ACCENT }} />
            <div className="flex flex-col items-center text-center gap-5 py-10">
                {client.logoUrl
                    ? <img src={client.logoUrl} alt="" className="h-20 w-20 rounded-2xl object-cover" />
                    : <div className="h-20 w-20 rounded-2xl flex items-center justify-center text-2xl font-bold text-white" style={{ background: ACCENT }}>{initials}</div>}
                <div>
                    <h1 className="text-3xl font-bold" style={{ color: '#111827' }}>{client.clientName}</h1>
                    <p className="text-lg mt-2" style={{ color: '#6b7280' }}>SEO Performance Report</p>
                    <p className="text-base font-medium mt-1" style={{ color: ACCENT }}>{monthLabel(reportMonth)}</p>
                </div>
            </div>
            <div className="text-xs text-center" style={{ color: '#9ca3af' }}>
                Prepared by {client.accountManager || 'Marketing Empire Group'}
            </div>
        </div>
    );
}

export function TitleBlock({ block, ctx }: { block: Block; ctx: ReportContext }) {
    if (!ctx.onEditText) {
        return <h2 className="text-2xl font-bold border-b-2 pb-2" style={{ color: '#111827', borderColor: ACCENT }}>{block.props.text || 'Section Title'}</h2>;
    }
    return (
        <input
            value={block.props.text ?? ''}
            onChange={e => ctx.onEditText!(block.id, { text: e.target.value })}
            placeholder="Section Title"
            className="w-full text-2xl font-bold border-0 border-b-2 pb-2 bg-transparent focus:outline-none"
            style={{ color: '#111827', borderColor: ACCENT }}
        />
    );
}

export function TextBlock({ block, ctx }: { block: Block; ctx: ReportContext }) {
    const field = block.props.field as 'executive_summary' | 'recommendations' | null;
    const value = field === 'executive_summary' ? ctx.executiveSummary
        : field === 'recommendations' ? ctx.recommendations
        : (block.props.content ?? '');
    const label = block.props.label as string | null;

    const body = ctx.onEditText ? (
        <textarea
            value={value}
            onChange={e => field && ctx.onEditField
                ? ctx.onEditField(field, e.target.value)
                : ctx.onEditText!(block.id, { content: e.target.value })}
            rows={Math.max(3, value.split('\n').length + 1)}
            placeholder="Type something here…"
            className="w-full text-sm leading-relaxed bg-transparent border border-transparent hover:border-gray-200 focus:border-gray-300 rounded-lg p-2 -m-2 focus:outline-none resize-y"
            style={{ color: '#374151' }}
        />
    ) : (
        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: '#374151' }}>{value || ' '}</p>
    );

    return (
        <div>
            {label && <h3 className="text-base font-semibold mb-2" style={{ color: ACCENT }}>{label}</h3>}
            {body}
        </div>
    );
}

export function ImageBlock({ block, ctx }: { block: Block; ctx: ReportContext }) {
    const { url, caption } = block.props;
    return (
        <div>
            {ctx.onEditText && (
                <input
                    value={url ?? ''}
                    onChange={e => ctx.onEditText!(block.id, { url: e.target.value })}
                    placeholder="Paste image URL…"
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 mb-2 focus:outline-none focus:border-gray-400 print:hidden"
                    style={{ color: '#374151' }}
                />
            )}
            {url
                ? <img src={url} alt={caption || ''} className="max-w-full rounded-lg border" style={{ borderColor: '#e5e7eb' }} />
                : !ctx.onEditText ? null : <div className="h-24 rounded-lg border border-dashed flex items-center justify-center text-xs print:hidden" style={{ borderColor: '#d1d5db', color: '#9ca3af' }}>Image preview</div>}
            {ctx.onEditText ? (
                <input
                    value={caption ?? ''}
                    onChange={e => ctx.onEditText!(block.id, { caption: e.target.value })}
                    placeholder="Caption (optional)"
                    className="w-full text-xs bg-transparent mt-1.5 focus:outline-none"
                    style={{ color: '#6b7280' }}
                />
            ) : caption ? <p className="text-xs mt-1.5" style={{ color: '#6b7280' }}>{caption}</p> : null}
        </div>
    );
}

const GRID_BOX_HEIGHT = 320;

function formatGridDate(d?: string): string | null {
    if (!d) return null;
    return new Date(d + 'T00:00:00').toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
}

function GridUploadSlot({
    label, url, date, uploading, editable, onUpload, onClear, onDateChange,
}: {
    label: string;
    url?: string;
    date?: string;
    uploading: boolean;
    editable: boolean;
    onUpload: (file: File) => void;
    onClear: () => void;
    onDateChange: (v: string) => void;
}) {
    const fileRef = useRef<HTMLInputElement>(null);
    const boxStyle = { height: GRID_BOX_HEIGHT, background: '#f9fafb' };

    return (
        <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#6b7280' }}>{label}</p>
            {url ? (
                <div className="relative rounded-lg border overflow-hidden" style={{ borderColor: '#e5e7eb', ...boxStyle }}>
                    <img src={url} alt={label} className="w-full h-full" style={{ objectFit: 'contain' }} />
                    {editable && (
                        <button onClick={onClear} className="print-hidden absolute top-1.5 right-1.5 rounded-full p-1" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
                            <X className="h-3 w-3" />
                        </button>
                    )}
                </div>
            ) : editable ? (
                <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="print-hidden w-full rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1.5 hover:border-gray-400 transition-colors"
                    style={{ borderColor: '#d1d5db', color: '#9ca3af', ...boxStyle }}
                >
                    {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                    <span className="text-xs">{uploading ? 'Uploading…' : `Upload ${label} screenshot`}</span>
                </button>
            ) : (
                <div className="rounded-lg border border-dashed flex items-center justify-center text-xs" style={{ borderColor: '#e5e7eb', color: '#9ca3af', ...boxStyle }}>
                    No image
                </div>
            )}
            <input
                ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }}
            />
            {editable && (
                <input
                    type="date" value={date ?? ''} onChange={e => onDateChange(e.target.value)}
                    className="print-hidden text-xs border rounded px-1.5 py-1 mt-1.5 w-full"
                    style={{ borderColor: '#e5e7eb', color: '#374151' }}
                />
            )}
            {formatGridDate(date) && <p className="text-xs mt-1" style={{ color: '#6b7280' }}>{formatGridDate(date)}</p>}
        </div>
    );
}

function GridSideBySide({ beforeUrl, afterUrl, beforeDate, afterDate }: { beforeUrl?: string; afterUrl?: string; beforeDate?: string; afterDate?: string }) {
    const boxStyle = { height: GRID_BOX_HEIGHT, background: '#f9fafb' };
    return (
        <div className="flex gap-4">
            {([['Before', beforeUrl, beforeDate], ['After', afterUrl, afterDate]] as const).map(([label, url, date]) => (
                <div key={label} className="flex-1 min-w-0">
                    <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#e5e7eb', ...boxStyle }}>
                        {url && <img src={url} alt={label} className="w-full h-full" style={{ objectFit: 'contain' }} />}
                    </div>
                    <p className="text-xs font-semibold mt-1.5" style={{ color: '#111827' }}>{label}</p>
                    {formatGridDate(date) && <p className="text-xs" style={{ color: '#6b7280' }}>{formatGridDate(date)}</p>}
                </div>
            ))}
        </div>
    );
}

export function GridComparisonBlock({ block, ctx }: { block: Block; ctx: ReportContext }) {
    const editable = !!ctx.onEditText;
    const { beforeUrl, beforeDate, afterUrl, afterDate } = block.props;
    const viewMode: 'slider' | 'side_by_side' = block.props.viewMode === 'side_by_side' ? 'side_by_side' : 'slider';
    const [uploadingSlot, setUploadingSlot] = useState<'before' | 'after' | null>(null);
    const [pct, setPct] = useState(50);
    const containerRef = useRef<HTMLDivElement>(null);
    const addFileRef = useRef<HTMLInputElement>(null);
    const bothUploaded = !!beforeUrl && !!afterUrl;
    // Exactly one scan uploaded — e.g. a client's first month, before any
    // baseline exists to compare against. This is the default path: a fresh
    // block starts as a single upload, not a two-slot Before/After form.
    const singleSide: 'before' | 'after' | null = beforeUrl && !afterUrl ? 'before' : afterUrl && !beforeUrl ? 'after' : null;
    // Only consulted while both slots are still empty — decides whether the
    // very first upload prompt is one generic dropzone or the two-slot form.
    const comparisonMode = block.props.comparisonMode === true;
    const position: 'left' | 'center' | 'right' =
        block.props.position === 'left' || block.props.position === 'right' ? block.props.position : 'center';
    const justify = position === 'left' ? 'flex-start' : position === 'right' ? 'flex-end' : 'center';

    async function upload(slot: 'before' | 'after', file: File) {
        setUploadingSlot(slot);
        try {
            const supabase = createClient();
            if (!supabase) return;
            const ext = file.name.split('.').pop() ?? 'png';
            const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
            const { error } = await supabase.storage.from('campaign-screenshots').upload(path, file, { contentType: file.type, upsert: true });
            if (error) return;
            const { data } = supabase.storage.from('campaign-screenshots').getPublicUrl(path);
            ctx.onEditText!(block.id, { [`${slot}Url`]: data.publicUrl });
        } finally {
            setUploadingSlot(null);
        }
    }

    function startDrag(e: React.PointerEvent) {
        e.preventDefault();
        const move = (ev: PointerEvent) => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const x = Math.min(Math.max(ev.clientX - rect.left, 0), rect.width);
            setPct((x / rect.width) * 100);
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    }

    return (
        <div>
            <div className="flex items-center gap-2 border-b-2 pb-2 mb-4" style={{ borderColor: ACCENT }}>
                <h2 className="text-lg font-semibold" style={{ color: '#111827' }}>Keyword Visibility Heatmaps</h2>
                {editable && bothUploaded && (
                    <div className="print-hidden ml-auto flex gap-1 text-xs">
                        {(['slider', 'side_by_side'] as const).map(mode => (
                            <button key={mode} onClick={() => ctx.onEditText!(block.id, { viewMode: mode })}
                                className="px-2 py-1 rounded"
                                style={{ background: viewMode === mode ? ACCENT : 'transparent', color: viewMode === mode ? '#fff' : '#6b7280' }}>
                                {mode === 'slider' ? 'Slider' : 'Side by side'}
                            </button>
                        ))}
                    </div>
                )}
                {editable && singleSide && (
                    <div className="print-hidden ml-auto flex gap-1">
                        {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([pos, Icon]) => (
                            <button key={pos} onClick={() => ctx.onEditText!(block.id, { position: pos })}
                                title={`Align ${pos}`}
                                className="p-1.5 rounded"
                                style={{ background: position === pos ? ACCENT : 'transparent', color: position === pos ? '#fff' : '#6b7280' }}>
                                <Icon className="h-3.5 w-3.5" />
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {singleSide ? (
                // One scan only — the default state. No Before/After framing
                // since there's nothing yet to compare it against. Aligned
                // per the Left/Center/Right toggle in the header above.
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: justify }}>
                    <div className="relative rounded-lg border overflow-hidden" style={{ borderColor: '#e5e7eb', height: GRID_BOX_HEIGHT, width: '100%', maxWidth: 480, background: '#f9fafb' }}>
                        <img src={singleSide === 'before' ? beforeUrl : afterUrl} alt="Ranking grid scan" className="w-full h-full" style={{ objectFit: 'contain' }} />
                        {editable && (
                            <button
                                onClick={() => ctx.onEditText!(block.id, singleSide === 'before' ? { beforeUrl: '' } : { afterUrl: '' })}
                                className="print-hidden absolute top-1.5 right-1.5 rounded-full p-1"
                                style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                            >
                                <X className="h-3 w-3" />
                            </button>
                        )}
                    </div>
                    {formatGridDate(singleSide === 'before' ? beforeDate : afterDate) && (
                        <p className="text-xs mt-1.5" style={{ color: '#6b7280' }}>{formatGridDate(singleSide === 'before' ? beforeDate : afterDate)}</p>
                    )}
                    {editable && (
                        <div className="print-hidden flex mt-2">
                            <button
                                onClick={() => addFileRef.current?.click()}
                                disabled={uploadingSlot !== null}
                                className="text-xs flex items-center gap-1.5 hover:underline"
                                style={{ color: '#6b7280' }}
                            >
                                {uploadingSlot ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                + Add {singleSide === 'before' ? 'After' : 'Before'} scan to enable comparison
                            </button>
                            <input
                                ref={addFileRef} type="file" accept="image/*" className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) upload(singleSide === 'before' ? 'after' : 'before', f); e.target.value = ''; }}
                            />
                        </div>
                    )}
                </div>
            ) : bothUploaded ? (
                <>
                    {/* Screen view — whichever mode is toggled. Always excluded from print. */}
                    <div className="print-hidden">
                        {viewMode === 'slider' ? (
                            <div ref={containerRef} className="relative select-none rounded-lg overflow-hidden border" style={{ borderColor: '#e5e7eb', height: GRID_BOX_HEIGHT, background: '#f9fafb' }}>
                                <img src={afterUrl} alt="After" className="absolute inset-0 w-full h-full" style={{ objectFit: 'contain' }} />
                                <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}>
                                    <img src={beforeUrl} alt="Before" className="absolute inset-0 w-full h-full" style={{ objectFit: 'contain' }} />
                                </div>
                                <div className="absolute top-2 left-2 text-xs font-semibold px-2 py-0.5 rounded" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>Before</div>
                                <div className="absolute top-2 right-2 text-xs font-semibold px-2 py-0.5 rounded" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>After</div>
                                <div
                                    onPointerDown={startDrag}
                                    className="absolute top-0 bottom-0 cursor-ew-resize"
                                    style={{ left: `calc(${pct}% - 14px)`, width: 28, display: 'flex', justifyContent: 'center' }}
                                >
                                    <div style={{ width: 2, background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.2)' }} />
                                    <div className="absolute top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white flex items-center justify-center shadow" style={{ color: '#374151' }}>
                                        <GripVertical className="h-4 w-4" />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <GridSideBySide beforeUrl={beforeUrl} afterUrl={afterUrl} beforeDate={beforeDate} afterDate={afterDate} />
                        )}
                    </div>
                    {/* Print/PDF — always side-by-side; a mid-drag slider position is meaningless on a static page. */}
                    <div className="print-only">
                        <GridSideBySide beforeUrl={beforeUrl} afterUrl={afterUrl} beforeDate={beforeDate} afterDate={afterDate} />
                    </div>
                </>
            ) : comparisonMode ? (
                // Explicitly opted into comparison mode before uploading anything —
                // two slots up front instead of the single default prompt.
                <div className="flex gap-4">
                    <GridUploadSlot label="Before" url={beforeUrl} date={beforeDate} uploading={uploadingSlot === 'before'} editable={editable}
                        onUpload={f => upload('before', f)} onClear={() => ctx.onEditText!(block.id, { beforeUrl: '' })}
                        onDateChange={v => ctx.onEditText!(block.id, { beforeDate: v })} />
                    <GridUploadSlot label="After" url={afterUrl} date={afterDate} uploading={uploadingSlot === 'after'} editable={editable}
                        onUpload={f => upload('after', f)} onClear={() => ctx.onEditText!(block.id, { afterUrl: '' })}
                        onDateChange={v => ctx.onEditText!(block.id, { afterDate: v })} />
                </div>
            ) : (
                // Default state — a single upload prompt. Lands in `afterUrl`;
                // comparison against a prior scan is opt-in from here.
                <div>
                    <GridUploadSlot label="Ranking Grid Scan" uploading={uploadingSlot === 'after'} editable={editable}
                        onUpload={f => upload('after', f)} onClear={() => {}}
                        onDateChange={v => ctx.onEditText!(block.id, { afterDate: v })} />
                    {editable && (
                        <div className="print-hidden flex justify-center mt-2">
                            <button
                                onClick={() => ctx.onEditText!(block.id, { comparisonMode: true })}
                                className="text-xs hover:underline"
                                style={{ color: '#6b7280' }}
                            >
                                Or add two scans to compare →
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Data widgets ─────────────────────────────────────────────────────────────

export function MetricsOverviewBlock({ block, ctx }: { block: Block; ctx: ReportContext }) {
    const source = block.props.source as ReportSourceKey;
    const def = REPORT_SECTIONS.find(s => s.key === source);
    const cur = ctx.metrics.current[source];
    const prev = ctx.metrics.previous[source] ?? {};
    const empty = !cur || Object.keys(cur).length === 0;
    if (empty && ctx.hideEmpty) return null;

    return (
        <div>
            <div className="flex items-center gap-2 border-b-2 pb-2 mb-4" style={{ borderColor: ACCENT }}>
                <h2 className="text-lg font-semibold" style={{ color: '#111827' }}>{def?.name}</h2>
            </div>
            {empty ? <EmptyNote text="No data for this source — sync or enter it manually on the Reports page." /> : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {METRIC_DEFS[source].map(m => cur![m.key] == null ? null : (() => {
                        const d = computeDelta(cur![m.key], prev[m.key], m.lowerIsBetter);
                        return (
                            <div key={m.key} className="rounded-xl p-3.5 border" style={{ borderColor: '#e5e7eb' }}>
                                <div className="text-[10px] uppercase tracking-wide" style={{ color: '#6b7280' }}>{m.label}</div>
                                <div className="flex items-baseline gap-1.5 mt-1">
                                    <span className="text-xl font-bold" style={{ color: '#111827' }}>{formatMetric(cur![m.key], m.format)}</span>
                                    {d && d.direction !== 'flat' && (
                                        <span className="text-[11px] font-semibold" style={{ color: d.isGood ? '#16a34a' : '#dc2626' }}>
                                            {d.direction === 'up' ? '▲' : '▼'} {Math.abs(d.pct).toFixed(1)}%
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })())}
                </div>
            )}
        </div>
    );
}

export function TrendBlock({ block, ctx }: { block: Block; ctx: ReportContext }) {
    const source = block.props.source as ReportSourceKey;
    const metricKeys = (block.props.metrics ?? []) as string[];
    const rows = ctx.history[source] ?? [];
    const data = rows.map(r => ({
        month: shortMonth(r.month),
        ...Object.fromEntries(metricKeys.map(k => [k, r.data[k] ?? null])),
    }));
    const hasEnough = rows.length >= 2;
    if (!hasEnough && ctx.hideEmpty) return null;

    return (
        <div>
            <div className="flex items-center gap-2 border-b-2 pb-2 mb-4" style={{ borderColor: ACCENT }}>
                <h2 className="text-lg font-semibold" style={{ color: '#111827' }}>{block.props.title || 'Trend'}</h2>
                <span className="text-xs" style={{ color: '#6b7280' }}>last {rows.length} month{rows.length === 1 ? '' : 's'}</span>
            </div>
            {!hasEnough ? (
                <EmptyNote text="Trend data builds up as monthly syncs run — check back next month." />
            ) : (
                <div style={{ width: '100%', height: 240 }}>
                    <ResponsiveContainer>
                        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: -12 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#d1d5db" />
                            <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#d1d5db" reversed={!!block.props.invertY} />
                            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                            {metricKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
                            {metricKeys.map((k, i) => (
                                <Line key={k} type="monotone" dataKey={k} name={METRIC_LABELS[k] ?? k}
                                    stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}

export function DistributionBlock({ ctx }: { ctx: ReportContext }) {
    const cur = ctx.metrics.current.ahrefs;
    const empty = !cur || cur.ranked_keywords == null;
    if (empty && ctx.hideEmpty) return null;

    const top10 = Number(cur?.top_10_keywords ?? 0);
    const top20 = Math.max(0, Number(cur?.top_20_keywords ?? 0) - top10);
    const top50 = Math.max(0, Number(cur?.top_50_keywords ?? 0) - top10 - top20);
    const beyond = Math.max(0, Number(cur?.ranked_keywords ?? 0) - top10 - top20 - top50);
    const data = [
        { bucket: 'Top 1–10', count: top10 },
        { bucket: '11–20', count: top20 },
        { bucket: '21–50', count: top50 },
        { bucket: '51+', count: beyond },
    ];

    return (
        <div>
            <div className="flex items-center gap-2 border-b-2 pb-2 mb-4" style={{ borderColor: ACCENT }}>
                <h2 className="text-lg font-semibold" style={{ color: '#111827' }}>Distribution of Keywords by Top Positions</h2>
            </div>
            {empty ? <EmptyNote text="No Ahrefs data — sync or enter it manually on the Reports page." /> : (
                <div style={{ width: '100%', height: 220 }}>
                    <ResponsiveContainer>
                        <BarChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: -12 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#d1d5db" />
                            <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} stroke="#d1d5db" />
                            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                            <Bar dataKey="count" name="Keywords" fill={ACCENT} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}

export function OrganicTableBlock({ ctx }: { ctx: ReportContext }) {
    // Merge GSC + GA4 history by month (ascending), last 6 months.
    const months = Array.from(new Set([
        ...(ctx.history.gsc ?? []).map(r => r.month),
        ...(ctx.history.ga4 ?? []).map(r => r.month),
    ])).sort().slice(-6);
    if (months.length === 0 && ctx.hideEmpty) return null;

    const bySource = (src: 'gsc' | 'ga4', month: string) =>
        (ctx.history[src] ?? []).find(r => r.month === month)?.data ?? {};

    return (
        <div>
            <div className="flex items-center gap-2 border-b-2 pb-2 mb-4" style={{ borderColor: ACCENT }}>
                <h2 className="text-lg font-semibold" style={{ color: '#111827' }}>Organic Traffic Overview</h2>
            </div>
            {months.length === 0 ? <EmptyNote text="No monthly history yet — data accrues as syncs run." /> : (
                <table className="w-full text-sm" style={{ color: '#374151' }}>
                    <thead>
                        <tr className="border-b" style={{ borderColor: '#e5e7eb' }}>
                            {['Month', 'Organic Sessions', 'Clicks', 'Impressions', 'CTR', 'Avg Position'].map(h => (
                                <th key={h} className="text-left py-2 pr-3 text-[11px] uppercase tracking-wide font-medium" style={{ color: '#6b7280' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {months.map(m => {
                            const gsc = bySource('gsc', m);
                            const ga4 = bySource('ga4', m);
                            return (
                                <tr key={m} className="border-b" style={{ borderColor: '#f3f4f6' }}>
                                    <td className="py-2 pr-3 font-medium" style={{ color: '#111827' }}>{shortMonth(m)}</td>
                                    <td className="py-2 pr-3">{formatMetric(ga4.organic_sessions, 'number')}</td>
                                    <td className="py-2 pr-3">{formatMetric(gsc.organic_clicks, 'number')}</td>
                                    <td className="py-2 pr-3">{formatMetric(gsc.impressions, 'number')}</td>
                                    <td className="py-2 pr-3">{formatMetric(gsc.ctr, 'percent')}</td>
                                    <td className="py-2 pr-3">{formatMetric(gsc.avg_position, 'decimal')}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </div>
    );
}

export function KeywordRankingsTableBlock({ block, ctx }: { block: Block; ctx: ReportContext }) {
    const [result, setResult] = useState<RankTrackerResult | null>(null);
    // Off by default — cleaner table. Turned on per-widget via the toggle below.
    const showLocation = block.props.showLocation === true;

    useEffect(() => {
        let cancelled = false;
        setResult(null);
        fetch(`/api/reports/${ctx.reportId}/rank-tracker`)
            .then(r => r.json())
            .then(d => { if (!cancelled) setResult(d); })
            .catch(() => { if (!cancelled) setResult({ status: 'error', message: 'Failed to load' }); });
        return () => { cancelled = true; };
    }, [ctx.reportId]);

    // Unlike "no data yet" for a synced metric, an unconnected Rank Tracker
    // project is actionable setup guidance — never auto-hide it, even when
    // "Hide empty widgets" is on, or the block just silently vanishes.

    const hasAnyLocation = result?.status === 'ok' && result.rows.some(r => r.location);
    const startLabel = monthDayOrdinal(ctx.reportMonth, 1);
    const endLabel = monthDayOrdinal(ctx.reportMonth, lastDayOfMonth(ctx.reportMonth));

    return (
        <div>
            <div className="flex items-center gap-2 border-b-2 pb-2 mb-4" style={{ borderColor: ACCENT }}>
                <h2 className="text-lg font-semibold" style={{ color: '#111827' }}>Keyword Rankings</h2>
                <span className="text-xs" style={{ color: '#6b7280' }}>{startLabel} — {endLabel}</span>
                {ctx.onEditText && hasAnyLocation && (
                    <label className="print-hidden ml-auto flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: '#6b7280' }}>
                        <input
                            type="checkbox"
                            checked={showLocation}
                            onChange={e => ctx.onEditText!(block.id, { showLocation: e.target.checked })}
                        />
                        Show location
                    </label>
                )}
            </div>
            {result === null ? (
                <p className="text-sm" style={{ color: '#9ca3af' }}>Loading tracked keywords…</p>
            ) : result.status === 'not_configured' ? (
                <EmptyNote text="No Ahrefs Rank Tracker project connected for this client — add a project ID in Client → Integrations." />
            ) : result.status === 'error' ? (
                <EmptyNote text={result.message} />
            ) : result.rows.length === 0 ? (
                <EmptyNote text="No tracked keywords found in this Rank Tracker project." />
            ) : (
                <table className="w-full text-sm" style={{ color: '#374151' }}>
                    <thead>
                        <tr className="border-b" style={{ borderColor: '#e5e7eb' }}>
                            {[...(showLocation ? ['Location'] : []), 'Keyword', startLabel, endLabel, 'Change'].map(h => (
                                <th key={h} className="text-left py-2 pr-3 text-[11px] uppercase tracking-wide font-medium" style={{ color: '#6b7280' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {result.rows.map((row, i) => (
                            <tr key={`${row.keyword}-${row.location ?? i}`} className="border-b" style={{ borderColor: '#f3f4f6' }}>
                                {showLocation && (
                                    <td className="py-2 pr-3 whitespace-nowrap" style={{ color: '#6b7280' }}>{row.location?.split(',')[0] ?? '—'}</td>
                                )}
                                <td className="py-2 pr-3 font-medium" style={{ color: '#111827' }}>{row.keyword}</td>
                                <td className="py-2 pr-3">{row.positionPrev ?? '—'}</td>
                                <td className="py-2 pr-3">{row.position ?? '—'}</td>
                                <td className="py-2 pr-3">
                                    {row.positionDiff == null || row.positionDiff === 0 ? (
                                        <span style={{ color: '#9ca3af' }}>—</span>
                                    ) : (
                                        <span style={{ color: row.positionDiff > 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                                            {row.positionDiff > 0 ? '▲' : '▼'} {Math.abs(row.positionDiff)}
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

/** Dispatch a block to its renderer. Returns null for hidden/empty widgets. */
export function RenderBlock({ block, ctx }: { block: Block; ctx: ReportContext }) {
    switch (block.type) {
        case 'cover': return <CoverBlock ctx={ctx} />;
        case 'title': return <TitleBlock block={block} ctx={ctx} />;
        case 'text': return <TextBlock block={block} ctx={ctx} />;
        case 'image': return <ImageBlock block={block} ctx={ctx} />;
        case 'grid_comparison': return <GridComparisonBlock block={block} ctx={ctx} />;
        case 'metrics_overview': return <MetricsOverviewBlock block={block} ctx={ctx} />;
        case 'trend': return <TrendBlock block={block} ctx={ctx} />;
        case 'distribution': return <DistributionBlock ctx={ctx} />;
        case 'organic_table': return <OrganicTableBlock ctx={ctx} />;
        case 'keyword_rankings_table': return <KeywordRankingsTableBlock block={block} ctx={ctx} />;
        case 'page_break': return null; // handled by the canvas (page split)
        default: return null;
    }
}

'use client';

// Block renderers for the report canvas. Rendered on white "paper" pages that
// double as the print/PDF output, so colors are a fixed light palette rather
// than theme variables.

import { useEffect, useState } from 'react';
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
                <span className="text-lg">{def?.icon}</span>
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

export function KeywordRankingsTableBlock({ ctx }: { ctx: ReportContext }) {
    const [result, setResult] = useState<RankTrackerResult | null>(null);

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

    return (
        <div>
            <div className="flex items-center gap-2 border-b-2 pb-2 mb-4" style={{ borderColor: ACCENT }}>
                <h2 className="text-lg font-semibold" style={{ color: '#111827' }}>All Keywords Rankings</h2>
                <span className="text-xs" style={{ color: '#6b7280' }}>{monthLabel(ctx.reportMonth)} — 1st vs last day</span>
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
                            {['Keyword', 'Start Position', 'End Position', 'Change'].map(h => (
                                <th key={h} className="text-left py-2 pr-3 text-[11px] uppercase tracking-wide font-medium" style={{ color: '#6b7280' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {result.rows.map(row => (
                            <tr key={row.keyword} className="border-b" style={{ borderColor: '#f3f4f6' }}>
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
        case 'metrics_overview': return <MetricsOverviewBlock block={block} ctx={ctx} />;
        case 'trend': return <TrendBlock block={block} ctx={ctx} />;
        case 'distribution': return <DistributionBlock ctx={ctx} />;
        case 'organic_table': return <OrganicTableBlock ctx={ctx} />;
        case 'keyword_rankings_table': return <KeywordRankingsTableBlock ctx={ctx} />;
        case 'page_break': return null; // handled by the canvas (page split)
        default: return null;
    }
}

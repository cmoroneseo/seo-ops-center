'use client';

import { useEffect, useState } from 'react';
import type { Block } from '@/lib/reports/blocks';
import type { ReportContext } from './ReportBlocks';
import { CANNIBAL_DEFINITION, formatCannibalHealth } from '@/lib/keyword-tracking/cannibalization';
import { keywordTrackingEnabled } from '@/lib/keyword-tracking/flag';
import {
    loadDraftTrackedKeywordReport,
    TRACKING_SNAPSHOT_DISCONNECTED,
    TRACKING_SNAPSHOT_EMPTY,
    TRACKING_SNAPSHOT_UNAVAILABLE,
    TRACKED_KEYWORDS_REPORT_LABEL,
    type TrackedKeywordReportSnapshot,
} from '@/lib/keyword-tracking/report-snapshot';
import {
    formatMeasuredCount,
    formatMeasuredPosition,
    rankingUrlLabel,
    RANKING_POSITION_DISPLAY,
} from '@/lib/keyword-tracking/rankings';
import { formatSpan } from '@/lib/search-insights/view';

const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const RULE = '#f3f4f6';

function safeHref(url: string | null): string | null {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

export function TrackedKeywordsReportBody({
    snapshot,
    message,
}: {
    snapshot: TrackedKeywordReportSnapshot | null;
    message?: string;
}) {
    if (!snapshot) {
        return (
            <section aria-label={TRACKED_KEYWORDS_REPORT_LABEL} data-tracked-keywords="gsc" data-state="unavailable">
                <h2 className="text-lg font-semibold" style={{ color: INK }}>{TRACKED_KEYWORDS_REPORT_LABEL}</h2>
                <p className="mt-3 text-sm" style={{ color: MUTED }}>{message ?? TRACKING_SNAPSHOT_UNAVAILABLE}</p>
            </section>
        );
    }

    const windowLabel = snapshot.window
        ? `Last 28 days · ${formatSpan(snapshot.window.current.start, snapshot.window.current.end)} vs ${formatSpan(snapshot.window.compare.start, snapshot.window.compare.end)}`
        : '';

    return (
        <section aria-label={TRACKED_KEYWORDS_REPORT_LABEL} data-tracked-keywords="gsc" data-state={snapshot.state}>
            <div className="border-b-2 pb-2 mb-4" style={{ borderColor: '#ef4444' }}>
                <h2 className="text-lg font-semibold" style={{ color: INK }}>{TRACKED_KEYWORDS_REPORT_LABEL}</h2>
                <p className="mt-1 text-xs" style={{ color: MUTED }}>
                    {RANKING_POSITION_DISPLAY}{windowLabel ? ` · ${windowLabel}` : ''}
                </p>
            </div>
            {snapshot.state === 'empty' ? (
                <p className="text-sm" style={{ color: MUTED }}>{TRACKING_SNAPSHOT_EMPTY}</p>
            ) : (
                <>
                    {snapshot.connected === false ? (
                        <p className="mb-3 text-sm" style={{ color: MUTED }}>{TRACKING_SNAPSHOT_DISCONNECTED}</p>
                    ) : null}
                    {snapshot.distribution ? (
                        <>
                            <p className="text-xs" style={{ color: MUTED }}>Not measurable keywords are not in a band.</p>
                            <ul aria-label="Position distribution" className="mt-3 mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                                {snapshot.distribution.map(band => (
                                    <li key={band.id} data-distribution={band.id}>
                                        <p className="text-xs" style={{ color: MUTED }}>{band.label}</p>
                                        <p className="font-semibold tabular-nums" style={{ color: INK }}>{band.count}</p>
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : null}
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm" style={{ color: '#374151' }} aria-label="Tracked keywords">
                            <thead>
                                <tr className="border-b" style={{ borderColor: LINE }}>
                                    {['Keyword', 'Change', RANKING_POSITION_DISPLAY, 'Clicks', 'Times shown', 'Best page'].map(heading => (
                                        <th key={heading} className="text-left py-2 pr-3 text-[11px] uppercase tracking-wide font-medium" style={{ color: MUTED }}>{heading}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {snapshot.keywords.map(row => {
                                    const href = safeHref(row.bestUrl);
                                    return (
                                        <tr key={row.id} className="border-b" style={{ borderColor: RULE }} data-keyword={row.keyword}>
                                            <th scope="row" className="py-2 pr-3 text-left font-medium" style={{ color: INK }}>{row.keyword}</th>
                                            <td className="py-2 pr-3" data-metric="change">{row.change ?? '—'}</td>
                                            <td className="py-2 pr-3 tabular-nums" data-metric="position">{formatMeasuredPosition(row.position)}</td>
                                            <td className="py-2 pr-3 tabular-nums" data-metric="clicks">{formatMeasuredCount(row.clicks)}</td>
                                            <td className="py-2 pr-3 tabular-nums" data-metric="impressions">{formatMeasuredCount(row.impressions)}</td>
                                            <td className="py-2 pr-3" data-metric="url">
                                                {href ? (
                                                    <a href={href} style={{ color: INK }} title={href}>{rankingUrlLabel(row.bestUrl)}</a>
                                                ) : rankingUrlLabel(row.bestUrl)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {snapshot.cannibalization ? (
                        <div className="mt-5" data-cannibalization="panel">
                            <h3 className="text-sm font-semibold" style={{ color: INK }}>Competing pages</h3>
                            <p className="mt-2 text-sm" style={{ color: INK }}>
                                <span style={{ color: MUTED }}>One main page </span>
                                <span className="font-semibold tabular-nums" data-metric="health">{formatCannibalHealth(snapshot.cannibalization.health)}</span>
                            </p>
                            {snapshot.cannibalization.health != null && snapshot.cannibalization.affected != null && snapshot.cannibalization.affected > 0 ? (
                                <p className="mt-1 text-xs" style={{ color: MUTED }} data-metric="affected">
                                    {snapshot.cannibalization.affected} of {snapshot.cannibalization.tracked} tracked keywords show on more than one page
                                </p>
                            ) : null}
                            {snapshot.cannibalization.health != null && snapshot.cannibalization.keywords.length === 0 ? (
                                <p className="mt-2 text-sm" style={{ color: MUTED }}>No pages are competing for the same search.</p>
                            ) : null}
                            <p className="mt-1 text-xs" style={{ color: MUTED }}>{CANNIBAL_DEFINITION}</p>
                        </div>
                    ) : null}
                </>
            )}
        </section>
    );
}

function usesFrozenSnapshot(ctx: ReportContext): boolean {
    return ctx.reportStatus === 'published' || (ctx.clientFacing === true && ctx.reportStatus !== 'draft');
}

export function TrackedKeywordsReportBlock({ block, ctx }: { block: Block; ctx: ReportContext }) {
    const enabled = keywordTrackingEnabled();
    const frozen = usesFrozenSnapshot(ctx);
    const [draft, setDraft] = useState<TrackedKeywordReportSnapshot | null>(null);
    const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');

    useEffect(() => {
        if (!keywordTrackingEnabled()) return;
        if (frozen) return;
        if (!ctx.organizationId || !ctx.client?.id) return;
        let cancelled = false;
        setPhase('loading');
        loadDraftTrackedKeywordReport({
            organizationId: ctx.organizationId,
            clientId: ctx.client.id,
        }).then(result => {
            if (cancelled || !result.enabled) return;
            if (!result.ok) {
                setDraft(null);
                setPhase('error');
                return;
            }
            setDraft(result.snapshot);
            setPhase('ready');
        }).catch(() => {
            if (!cancelled) setPhase('error');
        });
        return () => {
            cancelled = true;
        };
    }, [frozen, ctx.organizationId, ctx.client?.id]);

    if (!enabled) return null;
    if (frozen) return <div data-block-id={block.id}><TrackedKeywordsReportBody snapshot={ctx.trackingSnapshot ?? null} /></div>;
    if (!ctx.organizationId || !ctx.client?.id) {
        return <div data-block-id={block.id}><TrackedKeywordsReportBody snapshot={null} message="Tracked keywords are not available until this report has a client." /></div>;
    }
    if (phase === 'loading') {
        return <p className="text-sm" style={{ color: '#9ca3af' }} data-block-id={block.id}>Loading tracked keywords…</p>;
    }
    if (phase === 'error' || !draft) {
        return <div data-block-id={block.id}><TrackedKeywordsReportBody snapshot={null} message="Could not load tracked keywords." /></div>;
    }
    return <div data-block-id={block.id}><TrackedKeywordsReportBody snapshot={draft} /></div>;
}

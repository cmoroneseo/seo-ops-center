'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Deliverable } from '@/lib/types';
import type { FreshnessReadout } from '@/lib/reporting/freshness';
import type { LedgerEntry, LedgerModel } from '@/lib/search-reporting/ledger';
import { getDeliverables } from '@/lib/supabase/deliverables';
import { DeltaHeader, DeltaText } from '@/components/reporting/DeltaText';
import { Receipt } from '@/components/reporting/Receipt';
import { SourceChip } from '@/components/reporting/SourceChip';
import { StateBanner } from '@/components/reporting/StateBanner';
import { CreateDeliverableModal } from '@/components/deliverables/CreateDeliverableModal';
import { DeliverableDetailPanel } from '@/components/deliverables/DeliverableDetailPanel';
import { cn } from '@/lib/utils';

const RULES = [
    '28 days after ship vs 28 days before. Same weekdays. Incomplete days excluded.',
    'Organic and map pack judged separately. The GBP link never maps up an organic result.',
    'Under 28 days: "Too early to judge". Shown as a state, not a number.',
    'No pre-ship baseline: "Inconclusive". Applies until there are 28 days of Search Console history before the ship date.',
    'Correlation language only. "After this shipped…", never "this caused…".',
];

function shipLabel(iso: string): { day: string; year: string } {
    const [year, month, day] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return {
        day: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date),
        year: String(year),
    };
}

function count(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
}

function positionText(value: number | null): string {
    if (value == null) return '—';
    return value.toFixed(1);
}

function Sparkline({ points, label }: { points: number[]; label: string }) {
    if (points.length < 2) return null;
    const max = Math.max(...points, 1);
    const width = 128;
    const height = 36;
    const commands = points.map((value, index) => {
        const x = (index / (points.length - 1)) * width;
        const y = height - (value / max) * (height - 2) - 1;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-9 w-32 text-chart-1" role="img" aria-label={label}>
            <path d={commands} fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
    );
}

function MetricTile({
    label,
    value,
    surface,
    children,
}: {
    label: ReactNode;
    value: ReactNode;
    surface: 'organic' | 'map';
    children?: ReactNode;
}) {
    return (
        <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
            <div className={cn('mt-1 text-lg font-semibold tabular-nums', surface === 'organic' ? 'text-chart-1' : 'text-map')}>{value}</div>
            {children}
        </div>
    );
}

function receiptFor(entry: LedgerEntry, clientId: string, property: string | null, title: string, value: string, surface: 'organic' | 'map') {
    return {
        title,
        value,
        freshness: entry.footnote ?? 'Final',
        source: 'Google Search Console',
        property,
        dates: entry.datesLabel ?? entry.range,
        method: surface === 'organic'
            ? 'Sum of page-grain facts for this URL on the organic surface. Incomplete days are excluded.'
            : 'Sum of page-grain facts for this URL on the Business Profile link surface. Incomplete days are excluded.',
        note: entry.detail,
        audience: 'staff' as const,
        tier: 'A' as const,
        clientId,
        range: entry.range,
    };
}

function ResultCard({ entry, clientId, property }: { entry: LedgerEntry; clientId: string; property: string | null }) {
    const when = shipLabel(entry.shippedOn);
    const organic = entry.organic;
    const map = entry.map;
    return (
        <article className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3">
            <div className="pt-1 text-right">
                <p className="text-sm font-medium">{when.day}</p>
                <p className="text-xs text-muted-foreground">{when.year}</p>
            </div>
            <div className="min-w-0 rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded-full border border-border px-2 py-0.5">{entry.type}{entry.subtype ? ` · ${entry.subtype.replace(/_/g, ' ')}` : ''}</span>
                    <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-medium text-foreground">{entry.chip}</span>
                </div>
                <h3 className="mt-2 text-base font-semibold">{entry.title}</h3>
                <a href={entry.publishedUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-xs text-muted-foreground underline underline-offset-2">{entry.publishedUrl}</a>
                <p className="mt-3 text-sm text-muted-foreground">{entry.detail}</p>
                {organic && map && (
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <MetricTile
                            label="Organic impressions"
                            surface="organic"
                            value={<Receipt input={receiptFor(entry, clientId, property, 'Organic impressions', count(organic.after.impressions), 'organic')} />}
                        >
                            <Sparkline points={organic.after.series} label={`Organic impressions by day after ${entry.title} shipped`} />
                            {organic.before.impressions > 0 && (
                                <p className="mt-1 text-xs font-normal"><DeltaText current={organic.after.impressions} previous={organic.before.impressions} context={{ metric: 'count', audience: 'staff' }} /></p>
                            )}
                        </MetricTile>
                        <MetricTile
                            label={<DeltaHeader label="Avg organic position" metric="position" />}
                            value={positionText(organic.after.position)}
                            surface="organic"
                        />
                        <MetricTile
                            label="Map pack impressions"
                            surface="map"
                            value={<Receipt input={receiptFor(entry, clientId, property, 'Business Profile link impressions', count(map.after.impressions), 'map')} />}
                        />
                    </div>
                )}
                {entry.footnote && <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">{entry.footnote} No new verdict until sync recovers.</p>}
                <Link href={entry.insightsHref} className="mt-3 inline-block text-xs font-medium underline underline-offset-2">Open in Search Insights</Link>
            </div>
        </article>
    );
}

export function ResultsView({
    organizationId,
    clientId,
    clientName,
    clientDomain,
}: {
    organizationId: string;
    clientId: string;
    clientName: string;
    clientDomain: string | null;
}) {
    const [model, setModel] = useState<LedgerModel | null>(null);
    const [error, setError] = useState(false);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'work' | 'proof'>('work');
    const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
    const [selected, setSelected] = useState<Deliverable | null>(null);
    const [creating, setCreating] = useState(false);

    const reload = useCallback(() => {
        if (!organizationId || !clientId) return;
        setLoading(true);
        setError(false);
        Promise.all([
            fetch(`/api/search-reporting/ledger?clientId=${encodeURIComponent(clientId)}`).then(async (response) => {
                if (!response.ok) throw new Error('load');
                return response.json() as Promise<LedgerModel>;
            }),
            getDeliverables(organizationId, { clientId }),
        ]).then(([ledger, rows]) => {
            setModel(ledger);
            setDeliverables(rows);
            setLoading(false);
        }).catch(() => {
            setError(true);
            setLoading(false);
        });
    }, [organizationId, clientId]);

    useEffect(() => { reload(); }, [reload]);

    const openProof = (id: string) => {
        const row = deliverables.find(item => item.id === id);
        if (row) setSelected(row);
    };

    const notConnected: FreshnessReadout | null = model?.state === 'not_connected' && model.banner
        ? { state: 'not_connected', displayValue: '—', tone: 'neutral', copy: model.banner, asOf: null, tag: null }
        : null;

    return (
        <div className="min-w-0">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-semibold tracking-tight">Results</h2>
                    <p className="mt-1 max-w-xl text-sm text-muted-foreground">Shipped work and what Google showed after. If there&apos;s nothing to show, it says so.</p>
                </div>
                <div className="flex gap-2" role="tablist" aria-label="Results lists">
                    {([['work', 'All work'], ['proof', 'Missing proof']] as const).map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={filter === id}
                            onClick={() => setFilter(id)}
                            className={cn('rounded-lg px-3 py-1.5 text-sm font-medium', filter === id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted')}
                        >
                            {label}
                            {id === 'proof' && model ? ` (${model.missingProof.length})` : ''}
                        </button>
                    ))}
                </div>
            </div>

            {loading && <p role="status" className="text-sm text-muted-foreground">Loading results…</p>}
            {error && <p role="alert" className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">Results could not be loaded. This is not an empty list.</p>}

            {!loading && !error && model && (
                <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
                    <div className="min-w-0 space-y-4">
                        {notConnected && <StateBanner readout={notConnected} />}
                        {model.state === 'stale' && model.banner && (
                            <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{model.banner} Verdicts stay frozen until sync recovers.</p>
                        )}
                        <SourceChip source="Search Console · page facts" rangeLabel={model.historyStart ? `history from ${model.historyStart}` : 'no stored days in this read'} />

                        {filter === 'work' && model.entries.length === 0 && (
                            <div className="rounded-xl border border-dashed border-border p-6">
                                <p className="text-sm text-muted-foreground">{model.empty}</p>
                                <button type="button" onClick={() => setCreating(true)} className="mt-3 text-sm font-medium underline underline-offset-2">Add work</button>
                            </div>
                        )}
                        {filter === 'work' && model.entries.map(entry => (
                            <ResultCard key={entry.id} entry={entry} clientId={clientId} property={model.property} />
                        ))}
                        {filter === 'proof' && model.missingProof.length === 0 && (
                            <p className="text-sm text-muted-foreground">Every published deliverable has a page URL and a ship date.</p>
                        )}
                        {filter === 'proof' && model.missingProof.map(item => (
                            <button key={item.id} type="button" onClick={() => openProof(item.id)} className="block w-full rounded-xl border border-border bg-card p-4 text-left hover:border-primary/40">
                                <p className="text-sm font-semibold">{item.title}</p>
                                <p className="mt-1 text-xs text-muted-foreground">Missing proof. Add the live URL{item.deliveredOn ? '' : ' and the ship date'}.</p>
                            </button>
                        ))}
                    </div>

                    <aside className="space-y-4">
                        <section className="rounded-xl border border-border bg-card p-4">
                            <h3 className="text-sm font-semibold">How impact is judged</h3>
                            <ol className="mt-3 space-y-3 text-xs text-muted-foreground">
                                {RULES.map((rule, index) => (
                                    <li key={rule} className="flex gap-2"><span className="font-semibold text-foreground">{index + 1}</span><span>{rule}</span></li>
                                ))}
                            </ol>
                        </section>
                        <section className="rounded-xl border border-border bg-card p-4">
                            <h3 className="text-sm font-semibold">Ledger data gaps</h3>
                            <ul className="mt-3 space-y-3">
                                {model.gaps.map(gap => (
                                    <li key={gap.id}>
                                        <p className="flex items-baseline justify-between gap-3 text-sm"><span>{gap.label}</span><span className="font-semibold tabular-nums">{gap.value}</span></p>
                                        <p className="mt-0.5 text-xs text-muted-foreground">{gap.detail}</p>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    </aside>
                </div>
            )}

            <CreateDeliverableModal
                isOpen={creating}
                onClose={() => setCreating(false)}
                onCreated={() => { setCreating(false); reload(); }}
                organizationId={organizationId}
                clientId={clientId}
                clientDomain={clientDomain}
            />
            <DeliverableDetailPanel
                deliverable={selected}
                isOpen={selected !== null}
                onClose={() => setSelected(null)}
                onUpdated={() => { setSelected(null); reload(); }}
                organizationId={organizationId}
                clientName={clientName}
                clientDomain={clientDomain}
            />
        </div>
    );
}

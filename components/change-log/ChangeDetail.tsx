'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { impactCsv } from '@/lib/change-log/csv';
import { dailyRateText, overlapLabel } from '@/lib/change-log/impact';
import { nextStep } from '@/lib/change-log/verdict';
import { formatDay, formatDayWithYear, formatWentLive } from '@/lib/change-log/time';
import {
    CHANGE_TYPE_HINT,
    CHANGE_TYPE_LABEL,
    chartHeading,
    KPI_HINT,
    KPI_LABEL,
    resultLabel,
    SEARCH_CONSOLE_HINT,
    type Confounder,
    type QueryCompare,
    type SeoChange,
    type ImpactModel,
} from '@/lib/change-log/types';

import { ImpactChart } from './ImpactChart';
import { VerdictPill } from './VerdictPill';

type SortKey = 'query' | 'clicks' | 'impressions' | 'position';

export function ChangeDetail({
    change,
    impact,
    confounders,
    baselineNote,
    example,
    revertInitiallyOpen = false,
    onBack,
    onOpen,
    onRemove,
}: {
    change: SeoChange;
    impact: ImpactModel;
    confounders: Confounder[];
    baselineNote: string | null;
    example: boolean;
    revertInitiallyOpen?: boolean;
    onBack: () => void;
    onOpen: (id: string) => void;
    onRemove: () => void;
}) {
    const [revertOpen, setRevertOpen] = useState(revertInitiallyOpen);
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'impressions', dir: 'desc' });
    const head = impact.headline;
    const queries = useMemo(() => sortQueries(impact.queries, sort), [impact.queries, sort]);

    function download() {
        const blob = new Blob([impactCsv(change, impact)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${change.title.replace(/\s+/g, '-').toLowerCase()}-impact.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }

    function toggle(key: SortKey) {
        setSort(current => current.key === key
            ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
            : { key, dir: key === 'query' ? 'asc' : 'desc' });
    }

    return (
        <div className="change-log-sheet space-y-4">
            <div className="flex flex-wrap items-center gap-2 change-log-no-print">
                <Button type="button" variant="outline" size="sm" onClick={onBack}>Back</Button>
                <Button type="button" variant="outline" size="sm" onClick={download}>Spreadsheet (CSV)</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>Print or save as PDF</Button>
                {!example && <Button type="button" variant="ghost" size="sm" onClick={onRemove}>Remove from log…</Button>}
            </div>
            <header className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                    <VerdictPill verdict={head.verdict} estimate={head.estimate} />
                    <span className="text-xs text-muted-foreground">
                        {CHANGE_TYPE_LABEL[change.changeType]}
                        {CHANGE_TYPE_HINT[change.changeType] ? <span className="text-zinc-400"> ({CHANGE_TYPE_HINT[change.changeType]})</span> : null}
                    </span>
                    {head.ready && <span className="text-xs text-muted-foreground">{head.days}-day check</span>}
                </div>
                <h2 className="text-xl font-semibold tracking-tight">{change.title}</h2>
                <p className="text-sm text-muted-foreground">{head.note}</p>
                <p className="text-sm">{impact.causation}</p>
            </header>
            <dl className="grid gap-3 rounded-lg border border-border bg-card p-4 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-muted-foreground">Went live</dt><dd>{formatWentLive(change.liveAt)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Approved by</dt><dd>{change.approvedByName}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Before</dt><dd>{change.beforeText || '—'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">After</dt><dd>{change.afterText || '—'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Saved copy of the old version</dt><dd>{change.backupReference || '—'}</dd></div>
                <div>
                    <dt className="text-xs text-muted-foreground">What we&apos;re watching</dt>
                    <dd>
                        {KPI_LABEL[change.kpi]}
                        {KPI_HINT[change.kpi] ? <span className="text-zinc-400"> ({KPI_HINT[change.kpi]})</span> : null}
                    </dd>
                </div>
                {change.pages.map(page => (
                    <div key={page.url} className="sm:col-span-2">
                        <dt className="text-xs text-muted-foreground">{page.label || 'Page'}</dt>
                        <dd className="break-all">{page.url}{page.cmsPageId ? ` · page ${page.cmsPageId}` : ''}{page.cmsWidgetId ? ` · widget ${page.cmsWidgetId}` : ''}</dd>
                    </div>
                ))}
            </dl>
            <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {impact.checkpoints.map(checkpoint => (
                    <article key={checkpoint.days} className={`rounded-lg border bg-card p-3 ${checkpoint.days === head.days && head.ready ? 'border-zinc-900' : 'border-border'}`}>
                        <p className="text-xs text-muted-foreground">{checkpoint.days}-day check</p>
                        <p className="mt-1 text-sm font-medium">{resultLabel(checkpoint.verdict, checkpoint.estimate)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {checkpoint.ready ? dailyRateText(change.kpi, impact.baseline, checkpoint.page) : 'Not ready yet'}
                        </p>
                    </article>
                ))}
            </section>
            <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-1 text-sm font-medium">{chartHeading(change.kpi)}</h3>
                <p className="mb-3 text-xs text-muted-foreground">Compared with the rest of the site. Other changes on this page are listed below.</p>
                <ImpactChart points={impact.series} kpi={change.kpi} liveOn={change.liveOn} controlLabel={impact.controlLabel} />
            </section>
            <section className="rounded-lg border border-border bg-card p-4 text-sm">
                <h3 className="font-medium">Starting point</h3>
                <p className="mt-1 text-muted-foreground">
                    {impact.baselineReady
                        ? `${impact.baseline.daysPresent} of ${impact.baseline.daysExpected} days before ${formatDay(change.liveOn)} are saved. Numbers are final through ${formatDay(impact.finalThrough)}.`
                        : "The 28 days before this change aren't saved yet."}
                </p>
                {baselineNote && <p className="mt-1">{baselineNote}</p>}
                {impact.yoyNote && (
                    <p className="mt-2">
                        {impact.yoyNote}
                        {impact.yoy?.measured ? ` Last year: ${impact.yoy.clicks} clicks from Google, ${impact.yoy.impressions} times shown in Google.` : ''}
                    </p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">{impact.sources.join(' · ')}. {SEARCH_CONSOLE_HINT}</p>
            </section>
            <section className="rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between px-4 py-3">
                    <h3 className="text-sm font-medium">Search terms people used</h3>
                    <p className="text-xs text-muted-foreground">Only some terms. Google hides some searches.</p>
                </div>
                {impact.queries.length === 0 ? (
                    <p className="px-4 pb-4 text-sm text-muted-foreground">No search terms were saved on this change.</p>
                ) : (
                    <div className="insights-table-scroll">
                        <table className="w-full min-w-[640px] text-left text-sm">
                            <thead className="text-xs text-muted-foreground">
                                <tr>
                                    <SortHead label="Search term" onClick={() => toggle('query')} />
                                    <SortHead label="Clicks from Google" onClick={() => toggle('clicks')} />
                                    <SortHead label="Times shown in Google" onClick={() => toggle('impressions')} />
                                    <SortHead label="Average Google position" onClick={() => toggle('position')} />
                                </tr>
                            </thead>
                            <tbody>
                                {queries.map(query => (
                                    <tr key={query.query} className="border-t border-border">
                                        <td className="px-4 py-2">{query.query}</td>
                                        <td className="px-4 py-2 tabular-nums">{query.beforeClicks} → {query.afterClicks}</td>
                                        <td className="px-4 py-2 tabular-nums">{query.beforeImpressions} → {query.afterImpressions}</td>
                                        <td className="px-4 py-2 tabular-nums">{query.beforePosition ?? '—'} → {query.afterPosition ?? '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {!head.ready && impact.queries.length > 0 && (
                    <p className="px-4 pb-3 text-xs text-muted-foreground">These later numbers are not ready yet. Treat those cells as empty, not as zero.</p>
                )}
            </section>
            <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-medium">Other changes in this window</h3>
                {confounders.length === 0 ? (
                    <p className="mt-1 text-sm text-muted-foreground">None logged.</p>
                ) : (
                    <ul className="mt-2 space-y-2 text-sm">
                        {confounders.map(item => (
                            <li key={item.id}>
                                <button type="button" className="font-medium text-primary" onClick={() => onOpen(item.id)}>{item.title}</button>
                                <span className="text-muted-foreground"> · {CHANGE_TYPE_LABEL[item.changeType]} · {overlapLabel(item.overlap)} · {formatDayWithYear(item.liveOn)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
            <section className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">What happens next</h3>
                    <Button type="button" size="sm" variant="outline" className="change-log-no-print" onClick={() => setRevertOpen(true)}>How to undo</Button>
                </div>
                <p className="mt-1 text-sm">{nextStep(change.changeType, head.verdict)}</p>
                {revertOpen && (
                    <div className="mt-3 rounded-md bg-muted p-3 text-sm">
                        <p className="font-medium">Shows the saved steps. Doesn&apos;t change the live site.</p>
                        <p className="mt-1">{change.revertInstructions || 'No undo steps were saved.'}</p>
                        {change.backupReference && <p className="mt-1 text-muted-foreground">Saved copy of the old version: {change.backupReference}</p>}
                    </div>
                )}
            </section>
        </div>
    );
}

function SortHead({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <th className="px-4 py-2 font-medium">
            <button type="button" onClick={onClick} className="hover:text-foreground">{label}</button>
        </th>
    );
}

function sortQueries(rows: QueryCompare[], sort: { key: SortKey; dir: 'asc' | 'desc' }): QueryCompare[] {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        const value = sort.key === 'query'
            ? a.query.localeCompare(b.query)
            : sort.key === 'clicks'
                ? a.clicksDelta - b.clicksDelta
                : sort.key === 'impressions'
                    ? a.impressionsDelta - b.impressionsDelta
                    : (a.positionDelta ?? 0) - (b.positionDelta ?? 0);
        return value * dir;
    });
}

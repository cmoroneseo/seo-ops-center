import { GROUP_SUMMARY_NOTE, buildGroupSummary } from '@/lib/change-log/group';
import {
    buildResultsTable,
    changeTone,
    formatChangePercent,
    formatResultsValue,
    notReadyCopy,
} from '@/lib/change-log/results';
import { pagePath } from '@/lib/change-log/list';
import type { ImpactModel, PageImpactRow } from '@/lib/change-log/types';
import { cn } from '@/lib/utils';

export function GroupResults({ impact }: { impact: ImpactModel }) {
    const table = buildGroupSummary(impact);
    const waiting = table.ready ? null : notReadyCopy(buildResultsTable(impact).notReady);
    return (
        <>
            <section className="rounded-lg border border-border bg-card p-4" data-group-summary={table.ready ? 'ready' : 'waiting'}>
                <h3 className="text-sm font-medium">Group results</h3>
                <p className="mt-1 text-xs text-muted-foreground">{GROUP_SUMMARY_NOTE}</p>
                <p className="mt-1 text-xs text-muted-foreground">The result badge still compares this group with pages we didn&apos;t change.</p>
                {waiting && <p className="mt-2 text-sm">{waiting}</p>}
                <div className="insights-table-scroll mt-3">
                    <table className="w-full min-w-[520px] text-left text-sm">
                        <thead className="text-xs text-muted-foreground">
                            <tr>
                                <th className="px-3 py-2 font-medium">Metric</th>
                                <th className="px-3 py-2 font-medium">Control period</th>
                                <th className="px-3 py-2 font-medium">Test period</th>
                                <th className="px-3 py-2 font-medium">Change</th>
                            </tr>
                        </thead>
                        <tbody>
                            {table.rows.map(item => {
                                const tone = changeTone(item.change, item.lowerIsBetter);
                                return (
                                    <tr key={item.id} data-group-metric={item.id} className="border-t border-border">
                                        <th scope="row" className="px-3 py-2 text-left font-medium">
                                            {item.label}
                                            {item.id === 'ctr' && <span className="text-zinc-400"> (CTR)</span>}
                                            {item.note && <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{item.note}</span>}
                                        </th>
                                        <td className="px-3 py-2 tabular-nums">{formatResultsValue(item.kind, item.before)}</td>
                                        <td className="px-3 py-2 tabular-nums">
                                            {table.ready ? formatResultsValue(item.kind, item.after) : 'Not ready yet'}
                                        </td>
                                        <td className={cn('px-3 py-2 tabular-nums', tone === 'good' && 'text-green-800', tone === 'bad' && 'text-red-800')}>
                                            {formatChangePercent(item.change)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>
            <PageTable rows={impact.pageRows} ready={table.ready} />
        </>
    );
}

function PageTable({ rows, ready }: { rows: PageImpactRow[]; ready: boolean }) {
    return (
        <section className="rounded-lg border border-border bg-card" data-group-pages={rows.length}>
            <div className="px-4 py-3">
                <h3 className="text-sm font-medium">Each page</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                    {ready
                        ? 'Change from the control period to the test period.'
                        : 'The test period isn\'t ready yet, so these stay blank.'}
                </p>
            </div>
            {rows.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-muted-foreground">No pages were saved on this group.</p>
            ) : (
                <div className="insights-table-scroll">
                    <table className="w-full min-w-[640px] text-left text-sm">
                        <thead className="text-xs text-muted-foreground">
                            <tr>
                                <th className="px-4 py-2 font-medium">Page</th>
                                <th className="px-4 py-2 font-medium">Clicks</th>
                                <th className="px-4 py-2 font-medium">Times shown</th>
                                <th className="px-4 py-2 font-medium">Position</th>
                                <th className="px-4 py-2 font-medium">Click rate</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(row => (
                                <tr key={row.url} className="border-t border-border" data-group-page={row.url}>
                                    <th scope="row" className="px-4 py-2 text-left font-medium">
                                        {row.label || pagePath(row.url, row.url)}
                                        {row.label && <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{pagePath(row.url, row.url)}</span>}
                                    </th>
                                    <ChangeCell value={row.clicksChange} lowerIsBetter={false} />
                                    <ChangeCell value={row.impressionsChange} lowerIsBetter={false} />
                                    <ChangeCell value={row.positionChange} lowerIsBetter />
                                    <ChangeCell value={row.ctrChange} lowerIsBetter={false} />
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

function ChangeCell({ value, lowerIsBetter }: { value: number | null; lowerIsBetter: boolean }) {
    const tone = changeTone(value, lowerIsBetter);
    return (
        <td className={cn('px-4 py-2 tabular-nums', tone === 'good' && 'text-green-800', tone === 'bad' && 'text-red-800')}>
            {formatChangePercent(value)}
        </td>
    );
}

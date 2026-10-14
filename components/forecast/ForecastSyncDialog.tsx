'use client';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ForecastPreviewView } from '@/lib/forecast/present';
import { cn } from '@/lib/utils';

export interface ForecastWeekChoice {
    weekStart: string;
    label: string;
    selected: boolean;
}

interface ForecastSyncDialogProps {
    open: boolean;
    onClose: () => void;
    loading: boolean;
    error: string | null;
    weeks: ForecastWeekChoice[];
    preview: ForecastPreviewView | null;
    syncing: boolean;
    onToggleWeek: (weekStart: string) => void;
    onSync: () => void;
}

/**
 * Preview before a manual send. No step cards. Unknown hours stay an em dash
 * with the reason beside them.
 */
export function ForecastSyncDialog({
    open, onClose, loading, error, weeks, preview, syncing, onToggleWeek, onSync,
}: ForecastSyncDialogProps) {
    const selectedCount = weeks.filter(week => week.selected).length;
    return (
        <Dialog open={open} onOpenChange={next => { if (!next && !syncing) onClose(); }}>
            <DialogContent className="flex max-h-[min(85vh,820px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
                <DialogHeader className="border-b border-border px-6 py-5 text-left">
                    <DialogTitle>Sync to Campaign Desk</DialogTitle>
                    <DialogDescription>
                        Hours grouped by person and client. Nothing is sent until you sync.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                    <div role="group" aria-label="Weeks to sync" className="flex flex-wrap gap-2">
                        {weeks.map(week => (
                            <button
                                key={week.weekStart}
                                type="button"
                                aria-pressed={week.selected}
                                disabled={syncing || (week.selected && selectedCount === 1)}
                                onClick={() => onToggleWeek(week.weekStart)}
                                className={cn(
                                    'rounded-md border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                                    week.selected
                                        ? 'border-primary bg-primary/10 text-foreground'
                                        : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                                )}
                            >
                                {week.label}
                            </button>
                        ))}
                    </div>

                    {loading && <p className="mt-6 text-sm text-muted-foreground">Loading preview…</p>}

                    {error && (
                        <p role="alert" className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                            {error}
                        </p>
                    )}

                    {preview && !loading && !error && (
                        <div className="mt-5 space-y-4">
                            {preview.notes.map(note => (
                                <p key={note} className="text-sm text-muted-foreground">{note}</p>
                            ))}

                            {preview.warnings.length > 0 && (
                                <ul className="space-y-2">
                                    {preview.warnings.map(warning => (
                                        <li key={warning.message} className="flex flex-wrap items-baseline gap-x-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-foreground">
                                            <span>{warning.message}</span>
                                            {warning.href && (
                                                <a href={warning.href} className="font-medium text-primary underline-offset-4 hover:underline">
                                                    {warning.hrefLabel ?? 'Review'}
                                                </a>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}

                            {preview.syncDisabledReason && (
                                <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                                    {preview.syncDisabledReason}
                                </p>
                            )}

                            {preview.sections.map(section => (
                                <section key={section.weekStart} className="overflow-x-auto rounded-xl border border-border">
                                    <table className="w-full min-w-[640px] border-collapse text-sm">
                                        <caption className="border-b border-border bg-muted/30 px-4 py-2.5 text-left text-sm font-medium text-foreground">
                                            {section.heading}
                                            <span className="ml-2 font-normal text-muted-foreground">{section.basisLabel}</span>
                                        </caption>
                                        <thead>
                                            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                                                <th scope="col" className="px-4 py-2 text-left font-medium">Person</th>
                                                <th scope="col" className="px-3 py-2 text-left font-medium">Client</th>
                                                <th scope="col" className="px-3 py-2 text-left font-medium">Source</th>
                                                <th scope="col" className="px-3 py-2 text-right font-medium">Hours</th>
                                                <th scope="col" className="px-4 py-2 text-right font-medium">Allocation</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {section.emptyLabel && (
                                                <tr>
                                                    <td colSpan={5} className="px-4 py-4 text-muted-foreground">{section.emptyLabel}</td>
                                                </tr>
                                            )}
                                            {section.people.map(person => person.rows.map((row, index) => (
                                                <tr key={`${person.userId}-${index}`} className="border-b border-border last:border-b-0">
                                                    {index === 0 && (
                                                        <th scope="rowgroup" rowSpan={person.rows.length} className="px-4 py-3 text-left align-top font-medium text-foreground">
                                                            <span className="block">{person.displayName}</span>
                                                            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{person.email}</span>
                                                            {person.matchLabel && (
                                                                <span className="mt-1 block text-xs font-normal text-amber-500">{person.matchLabel}</span>
                                                            )}
                                                            {person.matchReason && (
                                                                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{person.matchReason}</span>
                                                            )}
                                                        </th>
                                                    )}
                                                    <td className="px-3 py-3 align-top text-foreground">
                                                        {row.clientLabel}
                                                        {row.clientReason && (
                                                            <span className="mt-0.5 block text-xs text-muted-foreground">{row.clientReason}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-3 align-top text-muted-foreground">{row.sourceLabel}</td>
                                                    <td className="px-3 py-3 text-right align-top tabular-nums text-foreground">
                                                        {row.hoursLabel}
                                                        {row.hoursReason && (
                                                            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{row.hoursReason}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-right align-top tabular-nums text-foreground">
                                                        {row.allocationLabel}
                                                        {row.allocationReason && (
                                                            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{row.allocationReason}</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            )))}
                                        </tbody>
                                    </table>
                                </section>
                            ))}
                        </div>
                    )}
                </div>

                <DialogFooter className="border-t border-border px-6 py-4">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={syncing}
                        className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onSync}
                        disabled={syncing || loading || Boolean(error) || !preview || preview.syncDisabled}
                        title={preview?.syncDisabledReason ?? undefined}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
                    >
                        {syncing ? 'Syncing…' : preview?.syncLabel ?? 'Sync'}
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

'use client';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import type { TimelineModel } from '@/lib/workspace-canvas/project';

export function WorkspaceMonthTimeline({
    model,
    monthLabel,
    compact,
    onViewTime,
    onPrevious,
    onNext,
    onSelect,
}: {
    model: TimelineModel;
    monthLabel: string;
    compact: boolean;
    onViewTime: () => void;
    onPrevious: () => void;
    onNext: () => void;
    onSelect: (cardId: string) => void;
}) {
    return (
        <section aria-labelledby="workspace-timeline-heading" className="min-w-0 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 id="workspace-timeline-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight"><CalendarDays className="h-5 w-5 text-muted-foreground" />{monthLabel}</h2>
                    <p className="text-xs text-muted-foreground">Scheduled work</p>
                </div>
                <div className="flex items-center gap-1"><button type="button" onClick={onViewTime} className="mr-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">Time details</button>
                    <button type="button" aria-label="Previous month" onClick={onPrevious} className="rounded-md border border-border p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft className="h-4 w-4" /></button>
                    <button type="button" aria-label="Next month" onClick={onNext} className="rounded-md border border-border p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ChevronRight className="h-4 w-4" /></button>
                </div>
            </div>
            {model.bars.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No dated work falls in this month.</p> : compact ? (
                <ol className="mt-4 space-y-2">
                    {model.bars.map(bar => (
                        <li key={bar.id}>
                            <button type="button" onClick={() => onSelect(bar.cardId)} className="w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <span className="font-medium">{bar.title}</span>
                                <span className="mt-0.5 block text-xs text-muted-foreground">{bar.label}</span>
                            </button>
                        </li>
                    ))}
                </ol>
            ) : (
                <div className="mt-4 overflow-x-auto">
                    <div className="min-w-[720px]">
                        <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2 text-[10px] text-muted-foreground">
                            <span />
                            <span className="grid" style={{ gridTemplateColumns: `repeat(${model.days.length}, minmax(0, 1fr))` }}>
                                {model.days.map(day => <span key={day} className="col-span-1 overflow-visible whitespace-nowrap text-left">{Number(day.slice(8)) % 7 === 1 ? new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>)}
                            </span>
                        </div>
                        <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                            {model.bars.map(bar => (
                                <button key={bar.id} type="button" onClick={() => onSelect(bar.cardId)} className="grid w-full grid-cols-[9rem_minmax(0,1fr)] items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={bar.label}>
                                    <span className="truncate text-xs font-medium">{bar.title}</span>
                                    <span className="grid" style={{ gridTemplateColumns: `repeat(${model.days.length}, minmax(0, 1fr))` }}>
                                        <span className="h-7 rounded-md border border-primary/30 bg-primary/20" style={{ gridColumn: `${bar.startIndex + 1} / ${bar.endIndex + 2}`, width: bar.point ? 8 : undefined, justifySelf: bar.point ? 'center' : undefined }} />
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}

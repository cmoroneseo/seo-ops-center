'use client';

import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { timelineWeeks } from '@/lib/workspace-canvas/calendar';
import { formatDayLabel, type TimelineModel, type WorkCard } from '@/lib/workspace-canvas/project';
import { cn } from '@/lib/utils';

export function WorkspaceMonthTimeline({ model, cards, monthLabel, loading, unavailable, saving, error, onPrevious, onNext, onToday, onSelect, onAddWork, onOpenDeliverables, onMoveDueDate }: {
    model: TimelineModel;
    cards: WorkCard[];
    monthLabel: string;
    loading: boolean;
    unavailable: boolean;
    saving: boolean;
    error: string | null;
    onPrevious: () => void;
    onNext: () => void;
    onToday: () => void;
    onSelect: (cardId: string) => void;
    onAddWork: (date?: string) => void;
    onOpenDeliverables: () => void;
    onMoveDueDate: (cardId: string, date: string) => void;
}) {
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dropDate, setDropDate] = useState<string | null>(null);
    const days = model.days;
    const weeks = timelineWeeks(days);
    // Each week gets equal width, including partial weeks at month boundaries.
    const columns = days.map((_, index) => {
        const week = weeks.find(item => item.start <= index && item.end >= index)!;
        return `minmax(0, ${1 / (week.end - week.start + 1)}fr)`;
    }).join(' ');
    const rows = [
        ...model.bars.map(bar => ({ id: bar.id, title: bar.title, startIndex: bar.startIndex, endIndex: bar.endIndex, point: bar.point, label: bar.label, cardId: bar.cardId, deliverable: false })),
        ...model.deadlines.filter(item => item.kind === 'deliverable').map(item => ({ id: item.id, title: item.title, startIndex: days.indexOf(item.dueDate), endIndex: days.indexOf(item.dueDate), point: true, label: `Deliverable due ${formatDayLabel(item.dueDate)}`, cardId: undefined, deliverable: true })),
    ].filter(row => row.startIndex >= 0).sort((a, b) => a.startIndex - b.startIndex || a.title.localeCompare(b.title));
    const disabled = loading || saving;
    const controlClass = 'rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

    return (
        <section aria-labelledby="workspace-timeline-heading" aria-busy={disabled} className="min-w-0 rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                    <h2 id="workspace-timeline-heading" className="flex items-center gap-2 text-xl font-semibold tracking-tight"><CalendarDays className="h-5 w-5 text-muted-foreground" />{monthLabel}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Tasks, plan work &amp; deliverable deadlines</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={onToday} disabled={disabled} className={controlClass}>Today</button>
                    <button type="button" onClick={onPrevious} disabled={disabled} aria-label="Previous timeline month" className={controlClass}><ChevronLeft className="h-4 w-4" /></button>
                    <button type="button" onClick={onNext} disabled={disabled} aria-label="Next timeline month" className={controlClass}><ChevronRight className="h-4 w-4" /></button>
                    <button type="button" onClick={() => onAddWork()} disabled={disabled} className={controlClass}><span className="flex items-center gap-2"><Plus className="h-4 w-4" />Add task</span></button>
                </div>
            </div>
            {unavailable && <p role="status" className="px-5 pb-3 text-sm text-amber-700 dark:text-amber-400">Some timeline sources could not be loaded. Work may be missing.</p>}
            {error && <p role="alert" className="px-5 pb-3 text-sm text-destructive">{error}</p>}
            {saving && <p role="status" className="px-5 pb-3 text-sm text-muted-foreground">Saving task date…</p>}
            <div className="overflow-x-auto rounded-b-xl">
                <div className="min-w-[760px] px-5 pb-5">
                    <div className="grid grid-cols-[12rem_minmax(0,1fr)] border-b border-border pb-3">
                        <span className="self-end text-xs font-medium text-muted-foreground">Scheduled work</span>
                        <div className="grid" style={{ gridTemplateColumns: columns }}>
                            {weeks.map((week, index) => <div key={week.start} style={{ gridColumn: `${week.start + 1} / ${week.end + 2}` }} className="border-l border-border px-3">
                                <p className="text-sm font-semibold">Week {index + 1}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">{formatDayLabel(days[week.start]).replace(/, \d{4}$/, '')}–{Number(days[week.end].slice(8))}</p>
                                <button type="button" onClick={() => onAddWork(days[week.start])} disabled={disabled} aria-label={`Add task in week ${index + 1}, starting ${formatDayLabel(days[week.start])}`} className="mt-2 inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><Plus className="h-3 w-3" />Add task</button>
                            </div>)}
                        </div>
                    </div>
                    <div className="relative min-h-40">
                        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 left-48 grid" style={{ gridTemplateColumns: columns }}>{weeks.map(week => <span key={week.start} style={{ gridColumn: `${week.start + 1} / ${week.end + 2}` }} className="border-l border-border/50" />)}</div>
                        {rows.length === 0 && <p className="py-8 text-sm text-muted-foreground">No scheduled work this month. Add a task to start planning.</p>}
                        {rows.map(row => {
                            const card = cards.find(item => item.id === row.cardId);
                            const open = () => row.deliverable ? onOpenDeliverables() : row.cardId && onSelect(row.cardId);
                            return <div key={row.id} className="grid min-h-16 grid-cols-[12rem_minmax(0,1fr)] border-b border-border/40 last:border-b-0">
                                <button type="button" onClick={open} disabled={disabled} title={row.title} className="min-w-0 rounded py-3 pr-4 text-left focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><span className="block truncate text-sm font-medium">{row.title}</span><span className="block truncate text-xs text-muted-foreground">{row.deliverable ? 'Deliverable due' : card?.statusLabel}</span></button>
                                <div className="relative grid items-center" style={{ gridTemplateColumns: columns }}>
                                    {days.map((date, index) => <div key={date} style={{ gridColumn: index + 1, gridRow: 1 }} onDragOver={event => { if (draggedId && !disabled) { event.preventDefault(); setDropDate(date); } }} onDragLeave={() => setDropDate(null)} onDrop={event => { event.preventDefault(); if (draggedId && !disabled) onMoveDueDate(draggedId, date); setDraggedId(null); setDropDate(null); }} className={cn('h-full min-h-16', weeks.some(week => week.start === index) && 'border-l border-border', dropDate === date && 'bg-primary/10 ring-2 ring-inset ring-ring')} />)}
                                    <button type="button" onClick={open} disabled={disabled} draggable={!!card?.taskId && !disabled} onDragStart={event => { setDraggedId(card!.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', card!.id); }} onDragEnd={() => { setDraggedId(null); setDropDate(null); }} title={`${row.title} · ${row.label}`} aria-label={`${row.title}, ${row.label}`} style={{ gridColumn: `${row.startIndex + 1} / ${row.endIndex + 2}`, gridRow: 1 }} className={cn('z-10 min-w-0 rounded-md border px-2 py-2 text-left text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', row.deliverable ? 'border-amber-500/30 bg-amber-500/15' : 'border-primary/30 bg-primary/20 hover:bg-primary/30', row.point && 'h-4 w-4 justify-self-center rotate-45 rounded-sm p-0')}>
                                        <span className={row.point ? 'sr-only' : 'block truncate'}>{row.title}</span>
                                    </button>
                                </div>
                            </div>;
                        })}
                    </div>
                </div>
            </div>
            <p className="px-5 py-3 text-xs text-muted-foreground">Select a bar or milestone to view details. Diamonds mark a single date. Use Add task in a week to start planning. Drag a task to change its due date, or edit its dates in task details.</p>
        </section>
    );
}

'use client';

import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { calendarDays, workOnDate } from '@/lib/workspace-canvas/calendar';
import { formatDayLabel, type TimelineModel, type WorkCard } from '@/lib/workspace-canvas/project';
import { cn } from '@/lib/utils';

export function WorkspaceMonthTimeline({ model, cards, month, monthLabel, loading, unavailable, saving, error, onPrevious, onNext, onToday, onSelect, onAddWork, onOpenDeliverables, onMoveDueDate }: {
    model: TimelineModel;
    cards: WorkCard[];
    month: string;
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
    const [expandedDates, setExpandedDates] = useState<string[]>([]);
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dropDate, setDropDate] = useState<string | null>(null);
    const today = new Date().toLocaleDateString('en-CA');
    const days = calendarDays(month);
    const disabled = loading || saving;
    const controlClass = 'rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

    return (
        <section aria-labelledby="workspace-calendar-heading" aria-busy={disabled} className="min-w-0 rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                    <h2 id="workspace-calendar-heading" className="flex items-center gap-2 text-xl font-semibold tracking-tight"><CalendarDays className="h-5 w-5 text-muted-foreground" />{monthLabel}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Tasks, plan work &amp; deliverable deadlines</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={onToday} disabled={disabled} className={controlClass}>Today</button>
                    <button type="button" onClick={onPrevious} disabled={disabled} aria-label="Previous calendar month" className={controlClass}><ChevronLeft className="h-4 w-4" /></button>
                    <button type="button" onClick={onNext} disabled={disabled} aria-label="Next calendar month" className={controlClass}><ChevronRight className="h-4 w-4" /></button>
                    <button type="button" onClick={() => onAddWork()} disabled={disabled} className={controlClass}><span className="flex items-center gap-2"><Plus className="h-4 w-4" />Add task</span></button>
                </div>
            </div>
            {unavailable && <p role="status" className="px-5 pb-3 text-sm text-amber-700 dark:text-amber-400">Some calendar sources could not be loaded. Work may be missing.</p>}
            {error && <p role="alert" className="px-5 pb-3 text-sm text-destructive">{error}</p>}
            {saving && <p role="status" className="px-5 pb-3 text-sm text-muted-foreground">Saving task date…</p>}
            <div className="overflow-x-auto rounded-b-xl">
                <div className="min-w-[700px]">
                    <div className="grid grid-cols-7 border-y border-border bg-muted/20">
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(label => <div key={label} className="px-3 py-3 text-xs font-medium text-muted-foreground">{label}</div>)}
                    </div>
                    <div className="grid grid-cols-7">
                        {days.map(date => {
                            const work = workOnDate(cards, date);
                            const deadlines = model.deadlines.filter(item => item.kind === 'deliverable' && item.dueDate === date);
                            const total = work.length + deadlines.length;
                            const expanded = expandedDates.includes(date);
                            const limit = expanded ? total : 3;
                            const inMonth = date.startsWith(month);
                            return (
                                <div key={date} onDragOver={event => { if (draggedId && !disabled) { event.preventDefault(); setDropDate(date); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropDate(null); }} onDrop={event => { event.preventDefault(); if (draggedId && !disabled) onMoveDueDate(draggedId, date); setDraggedId(null); setDropDate(null); }} className={cn('min-h-36 min-w-0 border-b border-r border-border/60 p-2 last:border-r-0 @min-[960px]:min-h-40', !inMonth && 'bg-muted/20', dropDate === date && 'bg-primary/10 ring-2 ring-inset ring-ring')}>
                                    <div className="mb-2 flex items-center justify-between gap-1">
                                        <span aria-label={date === today ? `Today, ${formatDayLabel(date)}` : formatDayLabel(date)} className={cn('flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium', date === today ? 'bg-foreground text-background' : !inMonth && 'text-muted-foreground')}>{Number(date.slice(8))}</span>
                                        <button type="button" disabled={disabled} onClick={() => onAddWork(date)} aria-label={`Add task on ${formatDayLabel(date)}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><Plus className="h-3.5 w-3.5" /></button>
                                    </div>
                                    <div className="space-y-1.5">
                                        {work.slice(0, limit).map(card => <button key={card.id} type="button" disabled={disabled} draggable={!!card.taskId && !disabled} onDragStart={event => { setDraggedId(card.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', card.id); }} onDragEnd={() => { setDraggedId(null); setDropDate(null); }} onClick={() => onSelect(card.id)} title={`${card.title} · ${card.statusLabel}${card.dueDate ? ` · Due ${formatDayLabel(card.dueDate)}` : ''}`} className="block w-full rounded-md border border-primary/20 bg-primary/10 px-2 py-1.5 text-left hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                                            <span className="block truncate text-xs font-medium">{card.title}</span><span className="block truncate text-[10px] text-muted-foreground">{card.statusLabel}{card.dueDate === date ? ' · Due' : card.startDate === date ? ' · Starts' : ''}</span>
                                        </button>)}
                                        {deadlines.slice(0, Math.max(0, limit - work.length)).map(item => <button key={item.id} type="button" disabled={disabled} onClick={onOpenDeliverables} title={item.title} className="block w-full rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-left hover:bg-amber-500/20 focus-visible:ring-2 focus-visible:ring-ring"><span className="block truncate text-xs font-medium">{item.title}</span><span className="block text-[10px] text-muted-foreground">Deliverable due</span></button>)}
                                        {total > 3 && <button type="button" onClick={() => setExpandedDates(current => expanded ? current.filter(item => item !== date) : [...current, date])} className="rounded px-1 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{expanded ? 'Show less' : `+${total - 3} more`}</button>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
            <p className="px-5 py-3 text-xs text-muted-foreground">Select work to view details. Use + to create a task on a date. Drag a task to change its due date, or edit its dates in task details.</p>
        </section>
    );
}

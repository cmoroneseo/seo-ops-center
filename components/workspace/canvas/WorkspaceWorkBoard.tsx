'use client';

import { formatDayLabel, LANE_PREVIEW_LIMIT, type BoardModel, type TimelineModel, type WorkCard } from '@/lib/workspace-canvas/project';
import { workspaceCanvasEnabled } from '@/lib/workspace-canvas/flag';
import { searchReportingEnabled } from '@/lib/search-reporting/flag';
import { LatestResultLink } from '@/components/marketing-plan/LatestResultLink';
import { CalendarDays, ClipboardList, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

function badgeClass(badge: string): string {
    if (badge === 'Blocked' || badge === 'Overdue') return 'bg-red-500/10 text-red-600 dark:text-red-400';
    if (badge === 'In review') return 'bg-blue-500/10 text-blue-700 dark:text-blue-300';
    if (badge === 'Carryover') return 'bg-amber-500/15 text-amber-800 dark:text-amber-300';
    return 'bg-muted text-muted-foreground';
}

function CardButton({ card, selected, onSelect }: { card: WorkCard; selected: boolean; onSelect: (id: string) => void }) {
    return (
        <button
            type="button"
            onClick={() => onSelect(card.id)}
            aria-pressed={selected}
            className={cn(
                'w-full rounded-lg border bg-muted/30 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'border-primary ring-2 ring-ring' : 'border-border hover:border-primary/40 hover:bg-muted/50',
            )}
        >
            <span className="flex items-start gap-3">
                <span className="rounded-lg bg-primary/10 p-2 text-primary"><ClipboardList className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-5">{card.title}</span>
                    {card.description && <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">{card.description}</span>}
                </span>
            </span>
            <span className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="inline-flex min-w-0 items-center gap-2"><span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">{card.assigneeLabel.split(' ').slice(0, 2).map(part => part[0]).join('')}</span>{card.assigneeLabel}</span>
                <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{card.dueDate ? formatDayLabel(card.dueDate) : 'No due date'}</span>
            </span>
            {card.badges.length > 0 && (
                <span className="mt-2 flex flex-wrap gap-1">
                    {card.badges.map(badge => <span key={badge} className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', badgeClass(badge))}>{badge}</span>)}
                </span>
            )}
        </button>
    );
}

function Lane({
    title,
    hint,
    tint,
    cards,
    empty,
    selectedId,
    onSelect,
    onViewAll,
}: {
    title: string;
    hint: string;
    tint: string;
    cards: WorkCard[];
    empty: string;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onViewAll: () => void;
}) {
    const preview = cards.slice(0, LANE_PREVIEW_LIMIT);
    return (
        <section className={cn('min-w-0 rounded-xl border p-4', tint)}>
            <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                    <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
                    <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
                <span className="rounded-full bg-muted px-2 py-1 text-xs tabular-nums text-muted-foreground">{cards.length}</span>
            </div>
            {preview.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
                <div className="space-y-2">
                    {preview.map(card => <CardButton key={card.id} card={card} selected={card.id === selectedId} onSelect={onSelect} />)}
                </div>
            )}
            {cards.length > LANE_PREVIEW_LIMIT && (
                <button type="button" onClick={onViewAll} className="mt-3 text-sm font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    View all {cards.length}
                </button>
            )}
        </section>
    );
}

export function WorkspaceWorkBoard({
    model,
    timeline,
    selectedId,
    onSelect,
    onViewAll,
    onOpenDeliverables,
    clientId,
}: {
    model: BoardModel;
    timeline: TimelineModel;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onViewAll: () => void;
    onOpenDeliverables: () => void;
    clientId?: string;
}) {
    if (model.state === 'error') {
        return <p role="status" className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Work could not be loaded. This is not an empty month.</p>;
    }
    const showLatestResult = Boolean(clientId) && searchReportingEnabled() && workspaceCanvasEnabled();
    const emptyNow = model.tasksUnavailable ? 'The full task list could not be loaded, so this lane is not “nothing due.”' : 'Nothing incomplete is due this month or carried over.';
    const emptyNext = model.tasksUnavailable ? 'Later dated work may be missing.' : 'No incomplete work is dated after this month.';
    return (
        <div className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold tracking-tight">Campaign work</h2><button type="button" onClick={onViewAll} className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">View all tasks <ArrowRight className="h-4 w-4" /></button></div>
            {model.tasksUnavailable && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">The full task list could not be loaded. Linked plan tasks are shown; other tasks may be missing.</p>}
            <div className="grid items-start gap-4 @min-[760px]:grid-cols-3">
                <Lane title="Now" hint="This month & carryover" tint="border-primary/20 bg-primary/5" cards={model.now} empty={emptyNow} selectedId={selectedId} onSelect={onSelect} onViewAll={onViewAll} />
                <Lane title="Next" hint="Coming up next" tint="border-blue-500/20 bg-blue-500/5" cards={model.next} empty={emptyNext} selectedId={selectedId} onSelect={onSelect} onViewAll={onViewAll} />
                <section className="min-w-0 rounded-xl border border-border bg-card p-4">
                    <h3 className="text-xl font-semibold tracking-tight">Impact</h3>
                    <p className="text-xs text-muted-foreground">Completed work & milestones</p>
                    {showLatestResult && clientId ? <LatestResultLink clientId={clientId} /> : null}
                    <div className="mt-3 space-y-3">
                        {model.impact.filter(entry => !entry.id.startsWith('search-')).map(entry => (
                            <article key={entry.id} className="rounded-lg border border-border bg-muted/30 p-3">
                                <h4 className="text-sm font-medium">{entry.title}</h4>
                                <p className="mt-1 text-xs text-muted-foreground">{entry.detail}</p>
                            </article>
                        ))}
                    </div>
                    <div className="mt-4 border-t border-border pt-4">
                        <h4 className="text-sm font-semibold">{timeline.deadlinesTitle}</h4>
                        {timeline.deadlines.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No open deadlines in this month.</p> : (
                            <ul className="mt-2 space-y-2">
                                {timeline.deadlines.slice(0, 6).map(item => (
                                    <li key={item.id}>
                                        <button type="button" onClick={() => item.cardId ? onSelect(item.cardId) : onOpenDeliverables()} className="block w-full rounded-md text-left text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                            <span className="block truncate font-medium" title={item.title}>{item.title}</span>
                                            <span className="block text-xs text-muted-foreground">{formatDayLabel(item.dueDate)} · {item.kind === 'task' ? 'Task' : 'Deliverable'}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </section>
            </div>

        </div>
    );
}

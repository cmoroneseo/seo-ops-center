'use client';

import { LANE_PREVIEW_LIMIT, type BoardModel, type WorkCard } from '@/lib/workspace-canvas/project';
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
                'w-full rounded-lg border bg-background p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'border-primary ring-2 ring-ring' : 'border-border hover:border-primary/40',
            )}
        >
            <span className="block truncate text-sm font-medium" title={card.title}>{card.title}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">{card.assigneeLabel} · {card.dueDate ?? 'No due date'}</span>
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
                    <h3 className="text-sm font-semibold">{title}</h3>
                    <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">{cards.length}</span>
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
    selectedId,
    onSelect,
    onViewAll,
}: {
    model: BoardModel;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onViewAll: () => void;
}) {
    if (model.state === 'error') {
        return <p role="status" className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Work could not be loaded. This is not an empty month.</p>;
    }
    const emptyNow = model.tasksUnavailable ? 'The full task list could not be loaded, so this lane is not “nothing due.”' : 'Nothing incomplete is due this month or carried over.';
    const emptyNext = model.tasksUnavailable ? 'Later dated work may be missing.' : 'No incomplete work is dated after this month.';
    return (
        <div className="min-w-0 space-y-3">
            {model.tasksUnavailable && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">The full task list could not be loaded. Linked plan tasks are shown; other tasks may be missing.</p>}
            <div className="grid gap-4 lg:grid-cols-3">
                <Lane title="Now" hint="Due this month, plus earlier carryover" tint="border-primary/20 bg-primary/5" cards={model.now} empty={emptyNow} selectedId={selectedId} onSelect={onSelect} onViewAll={onViewAll} />
                <Lane title="Next" hint="Nearest dated work after this month" tint="border-blue-500/20 bg-blue-500/5" cards={model.next} empty={emptyNext} selectedId={selectedId} onSelect={onSelect} onViewAll={onViewAll} />
                <section className="min-w-0 rounded-xl border border-border bg-card p-4">
                    <h3 className="text-sm font-semibold">Impact</h3>
                    <p className="text-xs text-muted-foreground">Verified outcomes. Not a claim that the work caused them.</p>
                    <div className="mt-3 space-y-3">
                        {model.impact.map(entry => (
                            <article key={entry.id} className="rounded-lg border border-border bg-background p-3">
                                <h4 className="text-sm font-medium">{entry.title}</h4>
                                <p className="mt-1 text-xs text-muted-foreground">{entry.detail}</p>
                            </article>
                        ))}
                    </div>
                </section>
            </div>
            <div className="rounded-xl border border-dashed border-border px-4 py-3">
                <h3 className="text-sm font-medium">Unscheduled</h3>
                <p className="text-xs text-muted-foreground">No due date is guessed for these.</p>
                {model.unscheduled.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{model.tasksUnavailable ? 'Unscheduled work may be missing.' : 'No undated incomplete work.'}</p> : (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {model.unscheduled.slice(0, LANE_PREVIEW_LIMIT).map(card => <CardButton key={card.id} card={card} selected={card.id === selectedId} onSelect={onSelect} />)}
                    </div>
                )}
                {model.unscheduled.length > LANE_PREVIEW_LIMIT && (
                    <button type="button" onClick={onViewAll} className="mt-3 text-sm font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View all {model.unscheduled.length}</button>
                )}
            </div>
        </div>
    );
}

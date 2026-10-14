import type { TimelineModel } from '@/lib/agreements/phase';

/** Roadmap columns generated from the root agreement. Hours stay an em dash when they are unknown. */
export function AgreementTimeline({ model }: { model: TimelineModel }) {
    if (model.pending) return <p className="text-sm text-muted-foreground">Loading agreement…</p>;
    return <div className="space-y-3">
        {model.notice && <p className="text-sm text-muted-foreground">{model.notice}</p>}
        <div className="flex gap-4 overflow-x-auto pb-2">
            {model.columns.map(column => <section key={column.key} aria-label={column.title} className="w-72 shrink-0 rounded-xl border border-border bg-muted/30 p-4">
                <h4 className="font-semibold">{column.title}</h4>
                <p className="mt-1 text-xs text-muted-foreground">{column.meta}</p>
                {column.agreementLabel && <p className="mt-1 text-xs text-muted-foreground">{column.agreementLabel}</p>}
                <ul className="mt-3 space-y-2">
                    {column.cards.map(card => <li key={card.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                        <p className="font-medium">{card.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{card.owner} · {card.dueLabel}</p>
                        {card.slipLabel && <p className="mt-1 text-xs font-medium text-amber-600">{card.slipLabel}</p>}
                    </li>)}
                    {!column.cards.length && <li className="py-6 text-sm text-muted-foreground">Nothing in this column.</li>}
                </ul>
                {column.commitments.length > 0 && <ul className="mt-3 space-y-2 border-t border-border pt-3">
                    {column.commitments.map(row => <li key={row.id} className="text-xs">
                        <p className="font-medium">{row.title}</p>
                        <p className="text-muted-foreground">Planned {row.plannedLabel} · Delivered {row.deliveredLabel}</p>
                        {row.mismatch && <p>Different agreement. Hours count once, on this service.</p>}
                    </li>)}
                </ul>}
            </section>)}
        </div>
    </div>;
}

'use client';

import type { PhasesModel } from '@/lib/workspace-canvas/project';
import type { RoadmapPhase } from '@/lib/marketing-plan-roadmap';

export function WorkspacePhaseRail({
    model,
    onOpenPhase,
    onCreatePlan,
}: {
    model: PhasesModel;
    onOpenPhase: (phase: RoadmapPhase) => void;
    onCreatePlan: () => void;
}) {
    const populated = model.phases.filter(phase => phase.total > 0);
    const empty = model.phases.filter(phase => phase.total === 0);
    return (
        <section aria-labelledby="workspace-phases-heading" className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 id="workspace-phases-heading" className="text-sm font-medium">SEO Plan phases</h2>
                <p className="text-xs text-muted-foreground">Checklist progress · Select a phase to view the plan</p>
            </div>
            {model.state === 'error' && <p role="status" className="text-sm text-muted-foreground">The SEO Plan could not be loaded.</p>}
            {model.state === 'empty' && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">No SEO Plan yet.</p>
                    <button type="button" onClick={onCreatePlan} className="rounded-lg border border-primary px-3 py-2 text-sm font-medium text-foreground hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Create SEO Plan</button>
                </div>
            )}
            {model.state === 'ready' && (
                <div className="flex flex-wrap items-center gap-3">
                {populated.length > 0 && <div className="flex min-w-0 flex-1 overflow-x-auto rounded-lg border border-border">
                    {populated.map(phase => (
                        <button
                            key={phase.key}
                            type="button"
                            onClick={() => onOpenPhase(phase.key)}
                            className="min-w-36 flex-1 shrink-0 border-r border-border bg-muted/20 px-4 py-3 last:border-r-0 text-left hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <span className="block text-sm font-medium">{phase.label}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">{`${phase.done} / ${phase.total} done`}</span>
                        </button>
                    ))}
                </div>}
                {empty.length > 0 && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>Not planned yet:</span>{empty.map(phase => <button key={phase.key} type="button" onClick={() => onOpenPhase(phase.key)} className="rounded px-1 py-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{phase.label}</button>)}</div>}
                </div>
            )}
        </section>
    );
}

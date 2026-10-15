'use client';

export function BasecampPlanListFields({
    lists,
    seoPlanTodolistId,
    onboardingTodolistId,
    onSeoPlanChange,
    onOnboardingChange,
}: {
    lists: Array<{ id: number | string; title?: string; name?: string }>;
    seoPlanTodolistId: string;
    onboardingTodolistId: string;
    onSeoPlanChange: (id: string) => void;
    onOnboardingChange: (id: string) => void;
}) {
    const field = 'w-full mt-1 p-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary';
    return (
        <div className="space-y-3">
            <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">SEO Plan list</label>
                <p className="mt-1 text-xs text-muted-foreground">Ongoing client work. New tasks and promoted plan items push to this list only.</p>
                <select className={field} value={seoPlanTodolistId} onChange={event => onSeoPlanChange(event.target.value)}>
                    <option value="">No SEO Plan list yet — choose the live work list</option>
                    {lists.map(list => (
                        <option key={list.id} value={String(list.id)}>{list.title || list.name}</option>
                    ))}
                </select>
            </div>
            <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Onboarding list</label>
                <p className="mt-1 text-xs text-muted-foreground">Setup to-dos, often named “Set up SEO campaign”. Import this list, then add it to the SEO Plan. Nothing pushes here.</p>
                <select className={field} value={onboardingTodolistId} onChange={event => onOnboardingChange(event.target.value)}>
                    <option value="">No onboarding list — import stays manual</option>
                    {lists.map(list => (
                        <option key={list.id} value={String(list.id)}>{list.title || list.name}</option>
                    ))}
                </select>
            </div>
        </div>
    );
}

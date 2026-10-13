'use client';

export interface OverviewItem {
    id: string;
    title: string;
    done: boolean;
}

export interface OverviewCommandProps {
    domain?: string | null;
    hoursLabel: string;
    agreement: 'recorded' | 'missing' | 'unknown';
    onboarding: {
        status: 'loading' | 'failed' | 'ready';
        done?: number;
        total?: number;
        items?: OverviewItem[];
    };
    monthLabel: string;
    tasks: {
        status: 'loading' | 'failed' | 'ready';
        due?: OverviewItem[];
        needDate?: number;
    };
    onOpenPlan: () => void;
    onOpenTasks: () => void;
}

function domainHref(domain: string): string {
    return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}

export function OverviewCommand({
    domain,
    hoursLabel,
    agreement,
    onboarding,
    monthLabel,
    tasks,
    onOpenPlan,
    onOpenTasks,
}: OverviewCommandProps) {
    const onboardingItems = onboarding.items ?? [];
    const due = tasks.due ?? [];
    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">This month</p>
                    <h2 className="text-2xl font-semibold tracking-tight">{monthLabel}</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                    {domain ? <a href={domainHref(domain)} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">{domain}</a> : '—'}
                    <span className="px-2 text-border">·</span>
                    <span>{hoursLabel}</span>
                </p>
            </div>
            {agreement === 'missing' && <p className="text-sm text-muted-foreground">Agreement not recorded.</p>}
            {agreement === 'unknown' && <p className="text-sm text-muted-foreground">—</p>}
            <div className="grid items-start gap-6 lg:grid-cols-2">
                <section aria-label="Onboarding" className="rounded-xl border border-border bg-card p-5">
                    <div className="mb-4 flex items-baseline justify-between gap-3">
                        <h3 className="text-base font-semibold">Onboarding</h3>
                        <p className="text-sm text-muted-foreground">
                            {onboarding.status === 'loading' && <span className="inline-block h-4 w-16 animate-pulse rounded bg-muted" aria-label="Loading onboarding" />}
                            {onboarding.status === 'failed' && '—'}
                            {onboarding.status === 'ready' && (onboarding.total ?? 0) === 0 && 'No onboarding work selected'}
                            {onboarding.status === 'ready' && (onboarding.total ?? 0) > 0 && `${onboarding.done ?? 0} of ${onboarding.total}`}
                        </p>
                    </div>
                    {onboarding.status === 'ready' && onboardingItems.length > 0 && (
                        <ul className="divide-y divide-border">
                            {onboardingItems.map(item => (
                                <li key={item.id}>
                                    <button type="button" onClick={onOpenPlan} className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm hover:text-primary">
                                        <span className={item.done ? 'text-muted-foreground' : 'font-medium'}>{item.title}</span>
                                        <span className="text-xs text-muted-foreground">{item.done ? 'Done' : 'Open'}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
                <section aria-label="This month" className="rounded-xl border border-border bg-card p-5">
                    <div className="mb-4 flex items-baseline justify-between gap-3">
                        <h3 className="text-base font-semibold">Due this month</h3>
                        <button type="button" onClick={onOpenPlan} className="text-sm font-medium text-primary hover:underline">Open plan</button>
                    </div>
                    {tasks.status === 'loading' && (
                        <div role="status" aria-label="Loading tasks" className="space-y-2">
                            <span className="sr-only">Loading tasks</span>
                            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
                        </div>
                    )}
                    {tasks.status === 'failed' && <p className="text-sm text-muted-foreground">—</p>}
                    {tasks.status === 'ready' && due.length === 0 && <p className="text-sm text-muted-foreground">Nothing due this month.</p>}
                    {tasks.status === 'ready' && due.length > 0 && (
                        <ul className="divide-y divide-border">
                            {due.slice(0, 8).map(task => (
                                <li key={task.id}>
                                    <button type="button" onClick={onOpenTasks} className="flex w-full py-3 text-left text-sm font-medium hover:text-primary">{task.title}</button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {tasks.status === 'ready' && (tasks.needDate ?? 0) > 0 && (
                        <button type="button" onClick={onOpenTasks} className="mt-4 text-sm font-medium text-primary hover:underline">
                            {tasks.needDate} need a date
                        </button>
                    )}
                    {tasks.status === 'failed' && <p className="mt-4 text-sm text-muted-foreground">Dates —</p>}
                </section>
            </div>
        </div>
    );
}

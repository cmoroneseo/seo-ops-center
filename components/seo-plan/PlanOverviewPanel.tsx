'use client';

import { useEffect, useState } from 'react';
import { OverviewCommand } from '@/components/seo-plan/OverviewCommand';
import { monthKey } from '@/lib/marketing-plan-execution';
import { onboardingProgress, taskDateCounts } from '@/lib/seo-plan/overview';
import { loadClientTasks, loadMarketingPlan } from '@/lib/seo-plan/prefetch';
import type { MarketingPlanItem, Task } from '@/lib/types';

type Load = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; items: MarketingPlanItem[]; tasks: Task[] };

export function PlanOverviewPanel({
    clientId,
    domain,
    hoursLabel,
    onOpenPlan,
    onOpenTasks,
}: {
    clientId: string;
    domain?: string | null;
    hoursLabel: string;
    onOpenPlan: () => void;
    onOpenTasks: () => void;
}) {
    const [load, setLoad] = useState<Load>({ status: 'loading' });
    const month = monthKey();

    useEffect(() => {
        let cancelled = false;
        setLoad({ status: 'loading' });
        Promise.all([
            loadMarketingPlan(clientId),
            loadClientTasks(clientId),
        ]).then(([plan, tasks]) => {
            if (cancelled) return;
            setLoad({ status: 'ready', items: plan?.items ?? [], tasks });
        }).catch(() => {
            if (!cancelled) setLoad({ status: 'failed' });
        });
        return () => { cancelled = true; };
    }, [clientId]);

    const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const progress = load.status === 'ready' ? onboardingProgress(load.items) : null;
    const counts = load.status === 'ready' ? taskDateCounts(load.tasks, month) : null;
    const due = load.status === 'ready'
        ? load.tasks.filter(task => task.status !== 'done' && task.status !== 'approved' && task.dueDate?.slice(0, 7) === month)
        : [];

    return (
        <OverviewCommand
            domain={domain}
            hoursLabel={hoursLabel}
            monthLabel={monthLabel}
            onOpenPlan={onOpenPlan}
            onOpenTasks={onOpenTasks}
            onboarding={load.status === 'ready' ? {
                status: 'ready',
                done: progress?.done ?? 0,
                total: progress?.total ?? 0,
                items: (progress?.items ?? []).map(item => ({ id: item.id, title: item.title, done: item.status === 'done' })),
            } : { status: load.status }}
            tasks={load.status === 'ready' ? {
                status: 'ready',
                due: due.map(task => ({ id: task.id, title: task.title, done: false })),
                needDate: counts?.needDate ?? 0,
            } : { status: load.status }}
        />
    );
}

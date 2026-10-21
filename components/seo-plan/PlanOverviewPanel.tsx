'use client';

import { useEffect, useState } from 'react';
import { OverviewCommand } from '@/components/seo-plan/OverviewCommand';
import { monthKey } from '@/lib/marketing-plan-execution';
import { onboardingProgress, taskDateCounts } from '@/lib/seo-plan/overview';
import { onboardingSectionItems, onboardingSectionProgress } from '@/lib/seo-plan/plan-work';
import { loadClientTasks, loadMarketingPlan } from '@/lib/seo-plan/prefetch';
import { parseStageListTasks, type StageListTask } from '@/lib/seo-plan/stage-list';
import type { MarketingPlanItem, Task } from '@/lib/types';

type Load = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; items: MarketingPlanItem[]; tasks: Task[]; stageTasks: StageListTask[] | null };

function overviewOnboarding(load: { items: MarketingPlanItem[]; stageTasks: StageListTask[] | null }): {
    done: number;
    total: number;
    items: { id: string; title: string; done: boolean }[];
} {
    if (load.stageTasks) {
        const progress = onboardingSectionProgress(load.stageTasks);
        return { done: progress.done, total: progress.total, items: onboardingSectionItems(load.stageTasks) };
    }
    const progress = onboardingProgress(load.items);
    return {
        done: progress.done,
        total: progress.total,
        items: progress.items.map(item => ({ id: item.id, title: item.title, done: item.status === 'done' })),
    };
}

async function loadStageTasks(clientId: string): Promise<StageListTask[] | null> {
    try {
        const response = await fetch(`/api/seo-plan/stage-list/${encodeURIComponent(clientId)}`, { cache: 'no-store' });
        if (!response.ok) return null;
        const body = await response.json() as { tasks?: unknown };
        return parseStageListTasks(body?.tasks);
    } catch {
        return null;
    }
}

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
            loadStageTasks(clientId),
        ]).then(([plan, tasks, stageTasks]) => {
            if (cancelled) return;
            setLoad({ status: 'ready', items: plan?.items ?? [], tasks, stageTasks });
        }).catch(() => {
            if (!cancelled) setLoad({ status: 'failed' });
        });
        return () => { cancelled = true; };
    }, [clientId]);

    const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const progress = load.status === 'ready' ? overviewOnboarding(load) : null;
    const counts = load.status === 'ready' ? taskDateCounts(load.tasks, month) : null;
    const due = load.status === 'ready'
        ? load.tasks.filter(task => task.status !== 'done' && task.dueDate?.slice(0, 7) === month)
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
                items: progress?.items ?? [],
            } : { status: load.status }}
            tasks={load.status === 'ready' ? {
                status: 'ready',
                due: due.map(task => ({ id: task.id, title: task.title, done: false })),
                needDate: counts?.needDate ?? 0,
            } : { status: load.status }}
        />
    );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { monthKey } from '@/lib/marketing-plan-execution';
import type { RoadmapPhase } from '@/lib/marketing-plan-roadmap';
import type { ClientProject } from '@/lib/types';
import { actionForegroundChoice, oklchContrast, type ActionForeground } from '@/lib/workspace-canvas/palette';
import { loadWorkspaceCanvas } from '@/lib/workspace-canvas/load';
import {
    formatMonthLabel, isMonthKey, projectWorkspaceCanvas, settleLatest, shiftMonth,
    type WorkspaceCanvasModel,
} from '@/lib/workspace-canvas/project';
import { WorkspaceAttentionPanel } from './WorkspaceAttentionPanel';
import { WorkspaceHoursGauge } from './WorkspaceHoursGauge';
import { WorkspaceMonthTimeline } from './WorkspaceMonthTimeline';
import { WorkspacePerformancePanel } from './WorkspacePerformancePanel';
import { WorkspacePhaseRail } from './WorkspacePhaseRail';
import { WorkspaceTaskInspector } from './WorkspaceTaskInspector';
import { WorkspaceWorkBoard } from './WorkspaceWorkBoard';

function useActionClass(): string {
    const [choice, setChoice] = useState<ActionForeground>('token');
    useEffect(() => {
        const update = () => {
            const styles = getComputedStyle(document.documentElement);
            setChoice(actionForegroundChoice({
                token: oklchContrast(styles.getPropertyValue('--primary'), styles.getPropertyValue('--primary-foreground')),
                ink: oklchContrast(styles.getPropertyValue('--primary'), styles.getPropertyValue('--foreground')),
            }));
        };
        update();
        const observer = new MutationObserver(update);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
        // BrandThemeSync replaces stylesheet text during organization changes
        // and Appearance previews, without necessarily changing the root class.
        observer.observe(document.head, { childList: true, subtree: true, characterData: true });
        return () => observer.disconnect();
    }, []);
    if (choice === 'ink') return 'bg-primary text-foreground hover:opacity-90';
    if (choice === 'neutral') return 'bg-foreground text-background hover:opacity-90';
    return 'bg-primary text-primary-foreground hover:opacity-90';
}

function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState(false);
    useEffect(() => {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setReduced(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);
    return reduced;
}

function siteHref(domain?: string): string | null {
    if (!domain) return null;
    if (/^https?:\/\//i.test(domain)) return domain;
    if (domain.includes('.')) return `https://${domain}`;
    return null;
}

export function ClientWorkspaceCanvas({
    client,
    organizationId,
    isOwner,
    refreshKey,
    onReassign,
    onAddWork,
    onOpenTask,
    onOpenPlan,
    onOpenPhase,
    onViewAllTasks,
    onReview,
    onViewTime,
    onOpenDeliverables,
    onMonthChange,
    selectedMonth,
}: {
    client: ClientProject;
    organizationId: string;
    isOwner: boolean;
    refreshKey: number;
    onReassign: () => void;
    onAddWork: () => void;
    onOpenTask: (taskId: string) => void;
    onOpenPhase: (phase: RoadmapPhase) => void;
    onOpenPlan: () => void;
    onViewAllTasks: () => void;
    onReview: (batchId: string) => void;
    onViewTime: () => void;
    onOpenDeliverables: () => void;
    onMonthChange: (month: string) => void;
    selectedMonth?: string | null;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const requestId = useRef(0);
    const actionClass = useActionClass();
    const reducedMotion = useReducedMotion();
    const [width, setWidth] = useState(0);
    const [month, setMonth] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [model, setModel] = useState<WorkspaceCanvasModel | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const element = rootRef.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setWidth(element.clientWidth));
        observer.observe(element);
        setWidth(element.clientWidth);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const requested = params.get('overviewMonth');
        const nextMonth = isMonthKey(requested) ? requested : monthKey();
        setMonth(nextMonth);
        onMonthChange(nextMonth);
        setSelectedId(params.get('overviewTask'));
    }, [client.id, onMonthChange]);

    useEffect(() => {
        if (selectedMonth && isMonthKey(selectedMonth)) setMonth(selectedMonth);
    }, [selectedMonth]);

    useEffect(() => {
        if (!month) return;
        const url = new URL(window.location.href);
        url.searchParams.set('overviewMonth', month);
        if (selectedId) url.searchParams.set('overviewTask', selectedId);
        else url.searchParams.delete('overviewTask');
        window.history.replaceState(null, '', url);
    }, [month, selectedId]);

    useEffect(() => {
        if (!month || !organizationId) return;
        const id = ++requestId.current;
        const controller = new AbortController();
        setLoading(true);
        loadWorkspaceCanvas({ client, organizationId, month, signal: controller.signal })
            .then(loaded => {
                if (!settleLatest(id, requestId.current, loaded) || !loaded) return;
                const next = projectWorkspaceCanvas(loaded.input);
                setModel(next);
                setSelectedId(current => {
                    if (!current) return null;
                    const match = next.cards.find(card => card.id === current || card.taskId === current || card.planItemId === current);
                    return match?.id ?? null;
                });
            })
            .catch(() => {
                if (settleLatest(id, requestId.current, true)) setModel(null);
            })
            .finally(() => {
                if (settleLatest(id, requestId.current, true)) setLoading(false);
            });
        return () => {
            controller.abort();
            requestId.current += 1;
        };
    }, [client, organizationId, month, refreshKey]);

    const compactTimeline = width > 0 && width < 760;
    const selected = model?.cards.find(card => card.id === selectedId) ?? null;
    const href = siteHref(client.domain);
    const changeMonth = (delta: number) => {
        if (!month) return;
        const nextMonth = shiftMonth(month, delta);
        setMonth(nextMonth);
        onMonthChange(nextMonth);
        setSelectedId(null);
    };

    return (
        <div ref={rootRef} className="@container min-w-0 max-w-full space-y-4 overflow-x-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        {href ? <a href={href} target="_blank" rel="noreferrer" className="truncate hover:text-foreground">{client.domain}</a> : client.domain && <span className="truncate">{client.domain}</span>}
                        <span className="truncate">Manager: {client.accountManager || 'Unassigned'}</span>
                        {isOwner && <button type="button" onClick={onReassign} className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Reassign</button>}
                    </div>
                    <div className="flex items-center gap-1" aria-live="polite">
                        <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)} className="rounded-md border border-border p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft className="h-4 w-4" /></button>
                        <p className="min-w-32 text-center text-sm font-semibold">{month ? formatMonthLabel(month) : 'Loading month'}</p>
                        <button type="button" aria-label="Next month" onClick={() => changeMonth(1)} className="rounded-md border border-border p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ChevronRight className="h-4 w-4" /></button>
                    </div>
                </div>
                <button type="button" onClick={onAddWork} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-base font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${actionClass}`}>
                    <Plus className="h-4 w-4" /> Add work
                </button>
            </div>

            {loading && !model && (
                <div className="grid gap-4" aria-hidden>
                    <div className="h-80 animate-pulse rounded-xl border border-border bg-card" />
                    <div className="h-40 animate-pulse rounded-xl border border-border bg-card" />
                </div>
            )}
            {!loading && !model && <p role="alert" className="text-sm text-destructive">The overview could not be loaded. Refresh to retry.</p>}
            {model && (
                <>
                    {loading && <p role="status" className="text-xs text-muted-foreground">Updating {model.monthLabel}…</p>}
                    <div className="grid gap-4 @min-[960px]:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)]">
                        <WorkspacePerformancePanel model={model.performance} reducedMotion={reducedMotion} />
                        <div className="space-y-4">
                            <WorkspaceHoursGauge model={model.hours} onViewTime={onViewTime} />
                            <WorkspaceAttentionPanel model={model.attention} onReview={onReview} onOpenDeliverables={onOpenDeliverables} onOpenTask={onOpenTask} />
                        </div>
                    </div>
                    <WorkspacePhaseRail model={model.phases} onOpenPhase={onOpenPhase} onCreatePlan={onOpenPlan} />
                    <WorkspaceWorkBoard model={model.board} timeline={model.timeline} selectedId={selected?.id ?? null} onSelect={setSelectedId} onViewAll={onViewAllTasks} onOpenDeliverables={onOpenDeliverables} />
                    <WorkspaceMonthTimeline model={model.timeline} monthLabel={model.monthLabel} compact={compactTimeline} onPrevious={() => changeMonth(-1)} onNext={() => changeMonth(1)} onSelect={setSelectedId} />
                </>
            )}
                <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelectedId(null); }}>
                    <DialogContent showCloseButton={false} aria-describedby={undefined} className="top-0 right-0 left-auto h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 content-start overflow-y-auto rounded-none border-y-0 border-r-0 bg-card p-0 sm:max-w-md data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 motion-reduce:animate-none">
                        <DialogTitle className="sr-only">{selected?.title ?? 'Work details'}</DialogTitle>
                        {selected && <WorkspaceTaskInspector card={selected} actionClass={actionClass} onClose={() => setSelectedId(null)} onOpenTask={taskId => { setSelectedId(null); onOpenTask(taskId); }} onOpenPlan={() => { setSelectedId(null); onOpenPlan(); }} />}
                    </DialogContent>
                </Dialog>
        </div>
    );
}

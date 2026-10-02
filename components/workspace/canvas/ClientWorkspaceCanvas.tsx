'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { updateTask } from '@/lib/supabase/tasks';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { dueDateMoveError } from '@/lib/workspace-canvas/calendar';
import { monthKey } from '@/lib/marketing-plan-execution';
import type { RoadmapPhase } from '@/lib/marketing-plan-roadmap';
import type { ClientProject } from '@/lib/types';
import { actionForegroundChoice, oklchContrast, type ActionForeground } from '@/lib/workspace-canvas/palette';
import { loadWorkspaceCanvas } from '@/lib/workspace-canvas/load';
import {
    isMonthKey, monthBounds, projectWorkspaceCanvas, settleLatest, shiftMonth,
    type WorkspaceCanvasModel,
} from '@/lib/workspace-canvas/project';
import { WorkspaceAttentionPanel } from './WorkspaceAttentionPanel';
import { WorkspaceHoursGauge } from './WorkspaceHoursGauge';
import { WorkspaceMonthTimeline } from './WorkspaceMonthTimeline';
import { WorkspacePerformancePanel } from './WorkspacePerformancePanel';
import { WorkspacePhaseRail } from './WorkspacePhaseRail';
import { WorkspaceSchedulePicker } from './WorkspaceSchedulePicker';
import { WorkspaceTaskEditor } from './WorkspaceTaskEditor';
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

export function ClientWorkspaceCanvas({
    client,
    organizationId,
    refreshKey,
    onAddWork,
    onOpenTask,
    onOpenPlan,
    onOpenPhase,
    onViewAllTasks,
    onReview,
    onOpenDeliverables,
    onMonthChange,
    selectedMonth,
}: {
    client: ClientProject;
    organizationId: string;
    refreshKey: number;
    onAddWork: (date?: string) => void;
    onOpenTask: (taskId: string) => void;
    onOpenPhase: (phase: RoadmapPhase) => void;
    onOpenPlan: () => void;
    onViewAllTasks: () => void;
    onReview: (batchId: string) => void;
    onOpenDeliverables: () => void;
    onMonthChange: (month: string) => void;
    selectedMonth?: string | null;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const requestId = useRef(0);
    const actionClass = useActionClass();
    const reducedMotion = useReducedMotion();
    const { userId } = useCurrentMember();
    const [calendarRefresh, setCalendarRefresh] = useState(0);
    const [calendarSaving, setCalendarSaving] = useState(false);
    const [scheduleDate, setScheduleDate] = useState<string | null>(null);
    const [calendarError, setCalendarError] = useState<string | null>(null);
    const [month, setMonth] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [model, setModel] = useState<WorkspaceCanvasModel | null>(null);
    const [loading, setLoading] = useState(true);

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
        let timer: ReturnType<typeof setTimeout> | undefined;
        let polls = 0;
        setLoading(true);
        const load = () => loadWorkspaceCanvas({ client, organizationId, month, signal: controller.signal })
            .then(loaded => {
                if (!settleLatest(id, requestId.current, loaded) || !loaded) return;
                const next = projectWorkspaceCanvas(loaded.input);
                setModel(next);
                const search = loaded.input.search;
                if (search.ok && search.coverage === 'ready' && polls < 6 &&
                    (search.current.some(point => point.clicks == null) || search.previous?.some(point => point.clicks == null))) {
                    polls += 1;
                    timer = setTimeout(() => { if (!controller.signal.aborted) void load(); }, 15000);
                }
                setSelectedId(current => {
                    if (!current) return null;
                    const match = next.cards.find(card => card.id === current || card.taskId === current || card.planItemId === current);
                    return match?.id ?? null;
                });
            })
            .catch(() => {
                if (polls === 0 && settleLatest(id, requestId.current, true)) setModel(null);
            })
            .finally(() => {
                if (settleLatest(id, requestId.current, true)) setLoading(false);
            });
        void load();
        return () => {
            clearTimeout(timer);
            controller.abort();
            requestId.current += 1;
        };
    }, [client, organizationId, month, refreshKey, calendarRefresh]);

    const selected = model?.cards.find(card => card.id === selectedId) ?? null;
    const bounds = month ? monthBounds(month) : null;
    const periodLabel = bounds ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).formatRange(new Date(`${bounds.start}T12:00:00`), new Date(`${bounds.end}T12:00:00`)) : 'Select month';
    const changeMonth = (delta: number) => {
        if (!month) return;
        const nextMonth = shiftMonth(month, delta);
        setMonth(nextMonth);
        onMonthChange(nextMonth);
        setSelectedId(null);
    };

    const moveDueDate = async (cardId: string, date: string): Promise<boolean> => {
        const card = model?.cards.find(item => item.id === cardId);
        if (!card || loading || calendarSaving) return false;
        const invalid = dueDateMoveError(card, date);
        if (invalid) { setCalendarError(invalid); return false; }
        if (card.dueDate === date) return true;
        setCalendarError(null);
        setCalendarSaving(true);
        try {
            const result = await updateTask(card.taskId!, { dueDate: date, updatedBy: userId || undefined });
            if (!result.success) { setCalendarError('Could not confirm the task date. Refresh and check its schedule before retrying.'); return false; }
            setCalendarRefresh(value => value + 1);
            window.dispatchEvent(new Event('client-activity:data-changed'));
            return true;
        } catch {
            setCalendarError('Could not save the task date. Refresh to verify its schedule before trying again.');
            return false;
        } finally { setCalendarSaving(false); }
    };

    return (
        <div ref={rootRef} className="@container min-w-0 max-w-full space-y-4 overflow-x-hidden">
            <div className="flex items-center justify-end">
                <button type="button" onClick={() => onAddWork()} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${actionClass}`}>
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
                    <div className="grid items-start gap-4 @min-[960px]:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)]">
                        <div className="min-w-0 space-y-4">
                            <WorkspacePerformancePanel model={model.performance} reducedMotion={reducedMotion} periodControl={
                                <div className="flex min-w-0 items-center rounded-lg border border-border bg-background/50 focus-within:ring-2 focus-within:ring-ring" aria-label="Overview reporting period">
                                    <button type="button" aria-label="Previous month" disabled={loading} onClick={() => changeMonth(-1)} className="rounded-l-lg p-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><ChevronLeft className="h-4 w-4" /></button>
                                    <label className="relative flex min-w-0 items-center gap-2 px-2 py-2 text-xs font-medium">
                                        <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
                                        <span>{periodLabel}</span>
                                        <input aria-label="Overview month" type="month" onClick={event => event.currentTarget.showPicker?.()} value={month ?? ''} disabled={loading} onChange={event => {
                                            const next = event.target.value;
                                            if (!isMonthKey(next)) return;
                                            setMonth(next); onMonthChange(next); setSelectedId(null);
                                        }} className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-wait" />
                                    </label>
                                    <button type="button" aria-label="Next month" disabled={loading} onClick={() => changeMonth(1)} className="rounded-r-lg p-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><ChevronRight className="h-4 w-4" /></button>
                                </div>
                            } />
                            <WorkspacePhaseRail model={model.phases} onOpenPhase={onOpenPhase} onCreatePlan={onOpenPlan} />
                        </div>
                        <div className="space-y-4">
                            <WorkspaceHoursGauge model={model.hours} />
                            <WorkspaceAttentionPanel model={model.attention} onReview={onReview} onOpenDeliverables={onOpenDeliverables} onOpenTask={onOpenTask} />
                        </div>
                    </div>
                    <WorkspaceWorkBoard model={model.board} timeline={model.timeline} selectedId={selected?.id ?? null} onSelect={setSelectedId} onViewAll={onViewAllTasks} onOpenDeliverables={onOpenDeliverables} />
                    <WorkspaceMonthTimeline model={model.timeline} cards={model.cards} monthLabel={model.monthLabel} loading={loading} unavailable={model.board.state === 'error' || model.board.tasksUnavailable || model.attention.deliverablesUnavailable || model.phases.state === 'error'} saving={calendarSaving} error={calendarError} onPrevious={() => changeMonth(-1)} onNext={() => changeMonth(1)} onToday={() => { const current = monthKey(); setMonth(current); onMonthChange(current); }} onSelect={setSelectedId} onAddWork={onAddWork} onScheduleExisting={date => { setCalendarError(null); setScheduleDate(date ?? model.timeline.days[0]); }} onOpenDeliverables={onOpenDeliverables} onMoveDueDate={(cardId, date) => { void moveDueDate(cardId, date); }} />
                </>
            )}
                {scheduleDate && model && <WorkspaceSchedulePicker key={scheduleDate} date={scheduleDate} cards={model.cards} saving={calendarSaving || loading} unavailable={model.board.tasksUnavailable || model.board.state === 'error'} error={calendarError} onClose={() => setScheduleDate(null)} onSchedule={moveDueDate} onEdit={cardId => { setScheduleDate(null); setSelectedId(cardId); }} />}
                <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelectedId(null); }}>
                    <DialogContent showCloseButton={false} aria-describedby={undefined} className="top-0 right-0 left-auto h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 content-start overflow-y-auto rounded-none border-y-0 border-r-0 bg-card p-0 sm:max-w-xl data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 motion-reduce:animate-none">
                        <DialogTitle className="sr-only">{selected?.title ?? 'Work details'}</DialogTitle>
                        {selected?.taskId ? <WorkspaceTaskEditor taskId={selected.taskId} organizationId={organizationId} clientId={client.id} userId={userId} onClose={() => setSelectedId(null)} onChanged={() => { setCalendarRefresh(value => value + 1); window.dispatchEvent(new Event('client-activity:data-changed')); }} /> : selected && <WorkspaceTaskInspector card={selected} actionClass={actionClass} onClose={() => setSelectedId(null)} onOpenTask={taskId => { setSelectedId(null); onOpenTask(taskId); }} onOpenPlan={() => { setSelectedId(null); onOpenPlan(); }} />}
                    </DialogContent>
                </Dialog>
        </div>
    );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { useTimer } from '@/components/providers/timer-provider';
import { StopConfirmSheet } from '@/components/timer/StopConfirmSheet';
import { getTimeLogs } from '@/lib/supabase/time-logs';
import {
    appendStageTasks,
    commitStageTasks,
    endPosition,
    isPendingStageTaskId,
    nextStagePositions,
    pendingStageTaskId,
    pendingStageTasks,
    rollbackStageTasks,
} from '@/lib/seo-plan/stage-add';
import { planCheckStatus } from '@/lib/seo-plan/plan-keymap';
import {
    applyPlanPanelSave,
    mergePlanTask,
    planDuplicateTitle,
    planPanelTask,
    planParentMove,
    planTasksWithout,
    type PlanPanelField,
    type PlanPanelSave,
} from '@/lib/seo-plan/plan-panel';
import type { DoneThisMonthLog } from '@/lib/seo-plan/done-this-month';
import { parseStageListTasks, type StageListTask } from '@/lib/seo-plan/stage-list';
import { useStageListMoves } from '@/lib/seo-plan/stage-list-moves';
import { calendarDay } from '@/lib/seo-plan/this-month';
import { createTask, deleteTask, getTask, updateTask } from '@/lib/supabase/tasks';
import type { UrlResultReadout } from '@/lib/search-reporting/url-results';
import { parseLiveUrlInput, subtaskLineDrafts } from '@/lib/tasks/live-url';
import type { Task, TimeLog } from '@/lib/types';
import {
    clickPlanRowTimer,
    closePlanStopReview,
    openPlanStopReview,
    planRowTimerView,
} from '@/lib/seo-plan/row-timer';
import { PanelSkeleton } from './PanelSkeleton';
import { PlanSidePanel } from './PlanSidePanel';
import { StagePlanListView, type PlanAssignee, type StageAddRequest } from './StagePlanListView';

/**
 * Loads the session-scoped stage list, creates tasks from the add bar, and
 * moves them by drag. A title, due, or assignee click opens the side panel.
 * Requests carry only the route client id. The server decides the organization.
 */
function initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '·';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

export function StagePlanList({
    clientId,
    clientName,
    onOpenResults,
}: {
    clientId: string;
    clientName: string;
    onOpenResults?: (month: string) => void;
}) {
    const { userId } = useCurrentMember();
    const { organization } = useOrganization();
    const [query, setQuery] = useState('');
    const [people, setPeople] = useState<PlanAssignee[]>([]);
    const [loggedHours, setLoggedHours] = useState<Record<string, number>>({});
    const [footerMonth, setFooterMonth] = useState<string | null>(null);
    const [footerLogs, setFooterLogs] = useState<DoneThisMonthLog[] | null>(null);
    const [footerLogsFor, setFooterLogsFor] = useState<string | null>(null);
    const footerMonthRef = useRef(footerMonth);
    footerMonthRef.current = footerMonth;
    const onMonthChange = useCallback((month: string) => {
        setFooterMonth(month);
    }, []);
    const [error, setError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [detail, setDetail] = useState<Task | null>(null);
    const [panel, setPanel] = useState<{ id: string; field: PlanPanelField | null } | null>(null);
    const [accountId, setAccountId] = useState<string | null>(null);
    const [logs, setLogs] = useState<TimeLog[]>([]);
    const [resultsByTaskId, setResultsByTaskId] = useState<Record<string, UrlResultReadout>>({});
    const [review, setReview] = useState<{ attemptId: string; taskId: string } | null>(null);
    const [urlPromptTaskId, setUrlPromptTaskId] = useState<string | null>(null);
    const [timerError, setTimerError] = useState<string | null>(null);
    const {
        runningTimer,
        pausedTimers,
        getElapsedSeconds,
        startTask,
        pause,
        resume,
        beginStop,
        getAttemptById,
    } = useTimer();
    const seenClient = useRef<string | null>(null);
    const { tasks, setList, updateList, move } = useStageListMoves(async (requested) => {
        const requestedClient = clientId;
        const response = await fetch(`/api/seo-plan/stage-list/${encodeURIComponent(clientId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({
                taskId: requested.taskId,
                stage: requested.stage,
                parentTaskId: requested.parentTaskId,
                index: requested.index,
                ...(requested.dueDate !== undefined ? { dueDate: requested.dueDate } : {}),
            }),
        });
        const payload = await response.json().catch(() => null) as { tasks?: unknown } | null;
        const updated = parseStageListTasks(payload?.tasks);
        if (!response.ok) throw new Error('move failed');
        if (seenClient.current !== requestedClient) return [];
        return updated;
    });

    useEffect(() => {
        let cancelled = false;
        if (seenClient.current !== clientId) {
            seenClient.current = clientId;
            setList(null);
            setQuery('');
            setPanel(null);
            setDetail(null);
        }
        setError(false);
        fetch(`/api/seo-plan/stage-list/${encodeURIComponent(clientId)}`, { cache: 'no-store' })
            .then(async response => {
                if (!response.ok) throw new Error('unavailable');
                return response.json() as Promise<{ tasks?: unknown; basecampAccountId?: unknown }>;
            })
            .then(body => {
                if (cancelled) return;
                const account = typeof body?.basecampAccountId === 'string' ? body.basecampAccountId.trim() : '';
                setAccountId(account || null);
                const fresh = parseStageListTasks(body?.tasks);
                updateList(loaded => {
                    if (!loaded) return fresh;
                    const pending = loaded.filter(task => isPendingStageTaskId(task.id));
                    return pending.length === 0 ? fresh : [...fresh, ...pending];
                });
            })
            .catch(() => {
                if (!cancelled) setError(true);
            });
        return () => { cancelled = true; };
    }, [clientId, reloadKey, setList, updateList]);

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/search-reporting/url-results?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' })
            .then(async response => {
                if (!response.ok) return null;
                return response.json() as Promise<{ connected?: boolean; byId?: Record<string, UrlResultReadout> }>;
            })
            .then(body => {
                if (cancelled) return;
                setResultsByTaskId(body?.connected && body.byId ? body.byId : {});
            })
            .catch(() => {
                if (!cancelled) setResultsByTaskId({});
            });
        return () => { cancelled = true; };
    }, [clientId, reloadKey]);

    useEffect(() => {
        const organizationId = organization?.id;
        if (!organizationId) return;
        let cancelled = false;
        getOrganizationMembers(organizationId).then(members => {
            if (cancelled) return;
            setPeople(members.map(member => {
                const name = member.user.fullName?.trim() || member.user.email;
                return { id: member.userId, name, initials: initialsOf(name) };
            }));
        }).catch(() => undefined);
        getTimeLogs(organizationId, { clientId }).then(logs => {
            if (cancelled) return;
            const totals: Record<string, number> = {};
            for (const log of logs) {
                if (!log.taskId) continue;
                totals[log.taskId] = (totals[log.taskId] ?? 0) + log.hours;
            }
            setLoggedHours(totals);
            setLogs(logs);
        }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [organization?.id, clientId, reloadKey]);

    // One client-scoped read for the footer. Row totals above stay all-time.
    // getTimeLogs already drops the running timer and unconfirmed imports.
    useEffect(() => {
        const organizationId = organization?.id;
        if (!organizationId || !footerMonth) return;
        let cancelled = false;
        setFooterLogs(null);
        setFooterLogsFor(null);
        getTimeLogs(organizationId, { clientId, month: footerMonth }).then(logs => {
            if (cancelled) return;
            setFooterLogs(logs.map(log => ({
                clientId: log.clientId,
                hours: log.hours,
                countsTowardBudget: log.countsTowardBudget,
                date: log.date,
                status: log.status,
            })));
            setFooterLogsFor(footerMonth);
        }).catch(() => {
            if (cancelled) return;
            setFooterLogs([]);
            setFooterLogsFor(footerMonth);
        });
        return () => { cancelled = true; };
    }, [organization?.id, clientId, footerMonth, reloadKey]);

    const reload = () => setReloadKey(key => key + 1);

    useEffect(() => {
        const id = panel?.id;
        if (!id || isPendingStageTaskId(id)) return;
        let cancelled = false;
        getTask(id).then(result => {
            if (cancelled || result.task?.id !== id) return;
            setDetail(current => {
                if (
                    current?.id === id
                    && current.updatedAt
                    && result.task?.updatedAt
                    && current.updatedAt > result.task.updatedAt
                ) return current;
                return result.task ?? current;
            });
        }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [panel?.id]);

    const savePanel = async (taskId: string, save: PlanPanelSave): Promise<string | null> => {
        if (seenClient.current !== clientId) return null;
        if (isPendingStageTaskId(taskId)) return 'That task is still being added.';
        const currentTasks = tasks ?? [];
        const snapshot = currentTasks.find(task => task.id === taskId);
        if (!snapshot) return 'That task is not on this plan.';
        if (save.field === 'parent') {
            const planned = planParentMove(currentTasks, taskId, save.parentTaskId);
            if (!planned.ok) return planned.error;
            if (!planned.move) return null;
            try {
                await move(planned.move);
            } catch {
                return 'Could not move that task.';
            }
            return null;
        }
        const now = new Date().toISOString();
        updateList(current => current?.map(task => (
            task.id === taskId ? applyPlanPanelSave(task, save, now) : task
        )) ?? current);
        const result = await updateTask(taskId, panelPatch(save));
        if (seenClient.current !== clientId) return null;
        if (!result.success || !result.data) {
            updateList(current => current?.map(task => (task.id === taskId ? snapshot : task)) ?? current);
            return result.error || 'Could not save that change.';
        }
        const saved = result.data;
        updateList(current => current?.map(task => (task.id === taskId ? mergePlanTask(task, saved) : task)) ?? current);
        setDetail(current => (current?.id === taskId ? saved : current));
        return null;
    };

    const duplicatePanel = async (): Promise<string | null> => {
        const sourceId = panel?.id;
        const organizationId = organization?.id;
        const source = tasks?.find(task => task.id === sourceId);
        if (!sourceId || !source || !organizationId) return 'Could not duplicate that task.';
        if (isPendingStageTaskId(sourceId)) return 'That task is still being added.';
        const stage = source.stage === 'onboarding' ? 'onboarding' : 'backlog';
        const parentTaskId = source.parentTaskId;
        const position = nextStagePositions(endPosition(tasks ?? [], stage, parentTaskId), 1)[0];
        const full = detail?.id === source.id ? detail : null;
        const result = await createTask({
            organizationId,
            clientId,
            title: planDuplicateTitle(source.title),
            ...(full?.description ? { description: full.description } : {}),
            assigneeIds: source.assigneeIds ?? [],
            ...(source.dueDate ? { dueDate: source.dueDate } : {}),
            ...(full?.estimatedHours != null ? { estimatedHours: full.estimatedHours } : {}),
            ...(source.category ? { category: source.category } : {}),
            ...(full ? { tags: full.tags ?? [] } : {}),
            status: 'todo',
            stage,
            ...(parentTaskId ? { parentTaskId } : {}),
            position,
            ...(userId ? { createdBy: userId } : {}),
            syncToBasecamp: false,
        });
        if (!result.success || !result.data) return result.error || 'Could not duplicate that task.';
        if (seenClient.current !== clientId) return null;
        const created = result.data;
        const row = stageRowFromTask(created, { stage, position, parentTaskId });
        updateList(current => current ? [...current.filter(task => task.id !== created.id), row] : [row]);
        setDetail(created);
        setPanel({ id: created.id, field: null });
        return null;
    };

    const deletePanel = async (): Promise<string | null> => {
        const id = panel?.id;
        if (!id) return null;
        if (isPendingStageTaskId(id)) return 'That task is still being added.';
        const result = await deleteTask(id);
        if (!result.success) return result.error || 'Could not delete that task.';
        if (seenClient.current !== clientId) return null;
        updateList(current => current ? planTasksWithout(current, id) : current);
        setPanel(null);
        setDetail(current => (current?.id === id ? null : current));
        return null;
    };

    const addTasks = async (input: StageAddRequest) => {
        if (input.items && input.items.length > 0) {
            await addPlanLines(input);
            return;
        }
        const requestedClient = clientId;
        const parentTaskId = input.parentTaskId ?? null;
        const ids = input.titles.map(() => pendingStageTaskId());
        const createdAt = new Date().toISOString();
        const drafts = parentTaskId
            ? subtaskLineDrafts(input.titles)
            : input.titles.map(title => ({ title: title.trim(), publishedUrl: null }));
        updateList(current => {
            if (!current) return current;
            const positions = nextStagePositions(endPosition(current, input.stage, parentTaskId), drafts.length);
            return appendStageTasks(current, pendingStageTasks({
                titles: drafts.map(draft => draft.title),
                publishedUrls: drafts.map(draft => draft.publishedUrl),
                stage: input.stage,
                parentTaskId,
                ids,
                createdAt,
                positions,
            }));
        });
        try {
            const response = await fetch(`/api/seo-plan/stage-list/${encodeURIComponent(clientId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({
                    stage: input.stage,
                    titles: input.titles,
                    ...(parentTaskId ? { parentTaskId } : {}),
                }),
            });
            const payload = await response.json().catch(() => null) as { tasks?: unknown } | null;
            const created = parseStageListTasks(payload?.tasks);
            if (!response.ok || created.length === 0) throw new Error('add failed');
            if (seenClient.current !== requestedClient) return;
            updateList(current => current ? commitStageTasks(current, ids, created) : created);
        } catch (caught) {
            if (seenClient.current === requestedClient) {
                updateList(current => current ? rollbackStageTasks(current, ids) : current);
            }
            throw caught instanceof Error ? caught : new Error('add failed');
        }
    };

    const addPlanLines = async (input: StageAddRequest) => {
        const requestedClient = clientId;
        const items = input.items ?? [];
        const ids = items.map(() => pendingStageTaskId());
        const createdAt = new Date().toISOString();
        const parentIds: (string | null)[] = [];
        let lastTop: string | null = null;
        items.forEach((item, index) => {
            if (item.depth === 1 && lastTop) parentIds.push(lastTop);
            else {
                parentIds.push(null);
                lastTop = ids[index];
            }
        });
        updateList(current => {
            if (!current) return current;
            const topCount = parentIds.filter(parentId => parentId == null).length;
            const topPositions = nextStagePositions(endPosition(current, input.stage, null), topCount);
            let topCursor = 0;
            const childCursor = new Map<string, number>();
            return appendStageTasks(current, items.map((item, index) => {
                const parentTaskId = parentIds[index] ?? null;
                let position: number;
                if (parentTaskId == null) {
                    position = topPositions[topCursor] ?? topCursor + 1;
                    topCursor += 1;
                } else {
                    const next = (childCursor.get(parentTaskId) ?? 0) + 1;
                    childCursor.set(parentTaskId, next);
                    position = next;
                }
                return {
                    id: ids[index] ?? pendingStageTaskId(),
                    title: item.title.trim(),
                    status: 'todo',
                    stage: input.stage,
                    position,
                    parentTaskId,
                    createdAt,
                    category: null,
                    basecamp: false,
                    recurring: false,
                    dueDate: input.dueDate ?? null,
                };
            }));
        });
        try {
            const response = await fetch(`/api/seo-plan/stage-list/${encodeURIComponent(clientId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({
                    stage: input.stage,
                    dueDate: input.dueDate ?? null,
                    items: items.map(item => ({ title: item.title, depth: item.depth })),
                }),
            });
            const payload = await response.json().catch(() => null) as { tasks?: unknown } | null;
            const created = parseStageListTasks(payload?.tasks);
            if (!response.ok || created.length !== items.length) throw new Error('add failed');
            if (seenClient.current !== requestedClient) return;
            updateList(current => current ? commitStageTasks(current, ids, created) : created);
        } catch (caught) {
            if (seenClient.current === requestedClient) {
                updateList(current => current ? rollbackStageTasks(current, ids) : current);
            }
            throw caught instanceof Error ? caught : new Error('add failed');
        }
    };

    const timerByTaskId: Record<string, ReturnType<typeof planRowTimerView>> = {};
    for (const task of tasks ?? []) {
        const view = planRowTimerView(task.id, runningTimer, pausedTimers, getElapsedSeconds);
        if (view.phase !== 'idle') timerByTaskId[task.id] = view;
    }

    const onRowTimer = (taskId: string) => {
        const task = tasks?.find(item => item.id === taskId);
        if (!task || isPendingStageTaskId(taskId)) return;
        setTimerError(null);
        void clickPlanRowTimer({
            taskId,
            taskTitle: task.title,
            taskStatus: task.status,
            clientId,
            clientName,
            running: runningTimer,
            paused: pausedTimers,
            controls: { startTask, pause, resume, beginStop },
        }).then(result => {
            if (result.action === 'start' && result.promoted) {
                updateList(current => current?.map(item => item.id === taskId && item.status === 'todo'
                    ? { ...item, status: 'in_progress' }
                    : item) ?? current);
                setDetail(current => current?.id === taskId && current.status === 'todo'
                    ? { ...current, status: 'in_progress' }
                    : current);
            }
        }).catch(caught => {
            setTimerError(caught instanceof Error ? caught.message : 'Unable to update the timer.');
        });
    };

    const onCheckRunning = (taskId: string) => {
        setTimerError(null);
        void openPlanStopReview({ taskId, running: runningTimer, beginStop }).then(opened => {
            if (opened) setReview({ attemptId: opened.attemptId, taskId });
        }).catch(caught => {
            setTimerError(caught instanceof Error ? caught.message : 'Unable to stop this timer.');
        });
    };

    const onReviewClose = () => {
        const current = review;
        setReview(null);
        if (!current) return;
        const attempt = getAttemptById(current.attemptId);
        void closePlanStopReview({ attempt, resume }).then(async outcome => {
            if (outcome === 'resumed' || seenClient.current !== clientId) return;
            const result = await getTask(current.taskId);
            if (!result.task || seenClient.current !== clientId) return;
            const fresh = result.task;
            updateList(list => list?.map(item => item.id === current.taskId ? {
                ...item,
                status: fresh.status,
                completedAt: fresh.completedAt ?? null,
                publishedUrl: fresh.publishedUrl ?? item.publishedUrl ?? null,
            } : item) ?? list);
            setDetail(shown => shown?.id === fresh.id ? fresh : shown);
            if (fresh.status === 'done' && !fresh.publishedUrl) setUrlPromptTaskId(current.taskId);
            const organizationId = organization?.id;
            if (!organizationId) return;
            const entries = await getTimeLogs(organizationId, { clientId });
            const totals: Record<string, number> = {};
            for (const log of entries) {
                if (!log.taskId) continue;
                totals[log.taskId] = (totals[log.taskId] ?? 0) + log.hours;
            }
            setLoggedHours(totals);
            setLogs(entries);
            const month = footerMonth;
            if (!month) return;
            const monthEntries = await getTimeLogs(organizationId, { clientId, month });
            if (seenClient.current !== clientId || footerMonthRef.current !== month) return;
            setFooterLogs(monthEntries.map(log => ({
                clientId: log.clientId,
                hours: log.hours,
                countsTowardBudget: log.countsTowardBudget,
                date: log.date,
                status: log.status,
            })));
            setFooterLogsFor(month);
        }).catch(caught => {
            setTimerError(caught instanceof Error ? caught.message : 'Unable to update this task.');
        });
    };

    if (error) {
        return (
            <p className="text-sm text-[#8b8b93]">
                Couldn&apos;t load this plan.{' '}
                <button type="button" onClick={reload} className="text-[#ec4899] hover:underline">Try again</button>
            </p>
        );
    }
    if (!tasks) return <PanelSkeleton label="Loading SEO plan" />;

    const open = panel && tasks.some(task => task.id === panel.id) ? panel : null;
    const selected = open ? tasks.find(task => task.id === open.id) : undefined;
    const model = open && selected ? planPanelTask({
        task: selected,
        tasks,
        detail: detail?.id === selected.id ? detail : null,
        people,
        accountId,
        logs: logs.filter(log => log.status === 'logged').map(log => ({
            taskId: log.taskId,
            date: log.date,
            hours: log.hours,
        })),
        loggedHours: loggedHours[selected.id],
    }) : null;

    return (
        <>
            {timerError && <p role="alert" className="mb-2 text-sm text-[#f87171]">{timerError}</p>}
            <StagePlanListView
                tasks={tasks}
                query={query}
                onQueryChange={setQuery}
                clientName={clientName}
                panelTaskId={open?.id ?? null}
                onClosePanel={() => setPanel(null)}
                onOpenTask={(taskId, field) => {
                    if (isPendingStageTaskId(taskId)) return;
                    setPanel({ id: taskId, field: field === 'due' || field === 'assignee' ? field : null });
                }}
                onAddTasks={addTasks}
                onReorder={move}
                resultsByTaskId={resultsByTaskId}
                people={people}
                loggedHours={loggedHours}
                timerByTaskId={timerByTaskId}
                onRowTimer={onRowTimer}
                onCheckRunning={onCheckRunning}
                urlPromptTaskId={urlPromptTaskId}
                monthLogs={footerLogs}
                monthLogsFor={footerLogsFor}
                onMonthChange={onMonthChange}
                clientId={clientId}
                onOpenResults={onOpenResults}
                panel={model ? (
                    <PlanSidePanel
                        key={model.id}
                        task={model}
                        tasks={tasks}
                        people={people}
                        clientName={clientName}
                        today={calendarDay(new Date())}
                        focusField={open?.field ?? null}
                        onSave={savePanel}
                        onDuplicate={duplicatePanel}
                        onDelete={deletePanel}
                        onClose={() => setPanel(null)}
                    />
                ) : null}
                onToggleCheck={async taskId => {
                    const task = tasks.find(item => item.id === taskId);
                    if (!task || isPendingStageTaskId(taskId)) return;
                    await savePanel(taskId, { field: 'status', status: planCheckStatus(task.status) });
                }}
                onSetLiveUrl={async (taskId, raw) => {
                    if (isPendingStageTaskId(taskId)) return 'Could not save that link.';
                    const parsed = parseLiveUrlInput(raw);
                    if (!parsed.ok) return parsed.error;
                    const result = await updateTask(taskId, { publishedUrl: parsed.publishedUrl });
                    if (!result.success || !result.data) return result.error || 'Could not save that link.';
                    if (seenClient.current !== clientId) return null;
                    updateList(current => current
                        ? current.map(task => task.id === taskId
                            ? { ...task, publishedUrl: result.data?.publishedUrl ?? null }
                            : task)
                        : current);
                    return null;
                }}
            />
            {review && (
                <StopConfirmSheet
                    attemptId={review.attemptId}
                    defaultMarkTaskComplete
                    onClose={onReviewClose}
                />
            )}
        </>
    );
}

function panelPatch(save: Exclude<PlanPanelSave, { field: 'parent' }>) {
    switch (save.field) {
        case 'title':
            return { title: save.title };
        case 'description':
            return { description: save.description };
        case 'dueDate':
            return { dueDate: save.dueDate };
        case 'status':
            return { status: save.status };
        case 'assignees':
            return { assigneeIds: save.assigneeIds };
        case 'estimate':
            return { estimatedHours: save.estimatedHours };
        case 'labels':
            return { category: save.category, tags: save.tags };
        case 'blocked':
            return { blockedReason: save.blockedReason };
        case 'onboarding':
            return { stage: save.stage };
        case 'liveUrl':
            return { publishedUrl: save.publishedUrl };
    }
}

function stageRowFromTask(
    created: Task,
    fallback: { stage: 'onboarding' | 'backlog'; position: number; parentTaskId: string | null },
): StageListTask {
    return {
        id: created.id,
        title: created.title,
        status: created.status,
        stage: created.stage ?? fallback.stage,
        position: created.position ?? fallback.position,
        parentTaskId: created.parentTaskId ?? fallback.parentTaskId,
        createdAt: created.createdAt ?? new Date().toISOString(),
        category: created.category ?? null,
        basecamp: Boolean(created.basecampTodoId),
        recurring: Boolean(created.recurrence),
        publishedUrl: created.publishedUrl ?? null,
        dueDate: created.dueDate ?? null,
        completedAt: created.completedAt ?? null,
        assigneeIds: created.assigneeIds ?? [],
        blockedReason: created.blockedReason?.trim() ? created.blockedReason.trim() : null,
    };
}

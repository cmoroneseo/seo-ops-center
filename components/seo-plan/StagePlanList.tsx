'use client';

import { useEffect, useRef, useState } from 'react';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
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
import { applyStageReorder, mergeStageTasks, restoreStageTasks, type StageReorderMove } from '@/lib/seo-plan/stage-reorder';
import { parseStageListTasks, type StageListTask } from '@/lib/seo-plan/stage-list';
import { getTask } from '@/lib/supabase/tasks';
import type { Task } from '@/lib/types';
import { PanelSkeleton } from './PanelSkeleton';
import { StagePlanListView, type StageAddRequest } from './StagePlanListView';

/**
 * Loads the session-scoped stage list, creates tasks from the add bar, moves
 * them by drag, and opens the existing task drawer. Requests carry only the
 * route client id. The server decides the organization.
 */
export function StagePlanList({ clientId, clientName }: { clientId: string; clientName: string }) {
    const { userId } = useCurrentMember();
    const [query, setQuery] = useState('');
    const [tasks, setTasks] = useState<StageListTask[] | null>(null);
    const [error, setError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [detail, setDetail] = useState<Task | null>(null);
    const seenClient = useRef<string | null>(null);
    const savingMove = useRef(false);

    useEffect(() => {
        let cancelled = false;
        if (seenClient.current !== clientId) {
            seenClient.current = clientId;
            setTasks(null);
            setQuery('');
        }
        setError(false);
        fetch(`/api/seo-plan/stage-list/${encodeURIComponent(clientId)}`, { cache: 'no-store' })
            .then(async response => {
                if (!response.ok) throw new Error('unavailable');
                return response.json() as Promise<{ tasks?: unknown }>;
            })
            .then(body => {
                if (cancelled) return;
                const fresh = parseStageListTasks(body?.tasks);
                setTasks(loaded => {
                    if (!loaded) return fresh;
                    const pending = loaded.filter(task => isPendingStageTaskId(task.id));
                    return pending.length === 0 ? fresh : [...fresh, ...pending];
                });
            })
            .catch(() => {
                if (!cancelled) setError(true);
            });
        return () => { cancelled = true; };
    }, [clientId, reloadKey]);

    const reload = () => setReloadKey(key => key + 1);

    const addTasks = async (input: StageAddRequest) => {
        const requestedClient = clientId;
        const parentTaskId = input.parentTaskId ?? null;
        const ids = input.titles.map(() => pendingStageTaskId());
        const createdAt = new Date().toISOString();
        setTasks(current => {
            if (!current) return current;
            const positions = nextStagePositions(endPosition(current, input.stage, parentTaskId), input.titles.length);
            return appendStageTasks(current, pendingStageTasks({
                titles: input.titles,
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
            setTasks(current => current ? commitStageTasks(current, ids, created) : created);
        } catch (caught) {
            if (seenClient.current === requestedClient) {
                setTasks(current => current ? rollbackStageTasks(current, ids) : current);
            }
            throw caught instanceof Error ? caught : new Error('add failed');
        }
    };

    const reorderTask = async (move: StageReorderMove) => {
        const requestedClient = clientId;
        if (savingMove.current) return;
        savingMove.current = true;
        let snapshot: StageListTask[] | null = null;
        let writeIds: string[] = [];
        setTasks(current => {
            if (!current) return current;
            const plan = applyStageReorder(current, move);
            if (!plan.ok || plan.writes.length === 0) return current;
            snapshot = current;
            writeIds = plan.writes.map(write => write.id);
            return plan.tasks;
        });
        if (!snapshot) {
            savingMove.current = false;
            return;
        }
        try {
            const response = await fetch(`/api/seo-plan/stage-list/${encodeURIComponent(clientId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({
                    taskId: move.taskId,
                    stage: move.stage,
                    parentTaskId: move.parentTaskId,
                    index: move.index,
                }),
            });
            const payload = await response.json().catch(() => null) as { tasks?: unknown } | null;
            const updated = parseStageListTasks(payload?.tasks);
            if (!response.ok) throw new Error('move failed');
            if (seenClient.current !== requestedClient) return;
            if (updated.length > 0) {
                setTasks(current => current ? mergeStageTasks(current, updated) : updated);
            }
        } catch (caught) {
            const previous = snapshot;
            const ids = writeIds;
            if (seenClient.current === requestedClient) {
                setTasks(current => current ? restoreStageTasks(current, previous, ids) : current);
            }
            throw caught instanceof Error ? caught : new Error('move failed');
        } finally {
            savingMove.current = false;
        }
    };

    if (error) {
        return <p className="text-sm text-muted-foreground">Could not load tasks for this plan.</p>;
    }
    if (!tasks) return <PanelSkeleton label="Loading SEO plan" />;

    return (
        <>
            <StagePlanListView
                tasks={tasks}
                query={query}
                onQueryChange={setQuery}
                clientName={clientName}
                onOpenTask={taskId => {
                    void getTask(taskId).then(result => {
                        if (result.task) setDetail(result.task);
                    }).catch(() => undefined);
                }}
                onAddTasks={addTasks}
                onReorder={reorderTask}
            />
            {detail && (
                <TaskDetailModal
                    task={detail}
                    isOpen
                    currentUserId={userId}
                    onClose={() => { setDetail(null); reload(); }}
                    onUpdate={() => reload()}
                    onDelete={() => { setDetail(null); reload(); }}
                />
            )}
        </>
    );
}

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
import { parseStageListTasks } from '@/lib/seo-plan/stage-list';
import { useStageListMoves } from '@/lib/seo-plan/stage-list-moves';
import { getTask, updateTask } from '@/lib/supabase/tasks';
import { parseLiveUrlInput, subtaskLineDrafts } from '@/lib/tasks/live-url';
import type { Task } from '@/lib/types';
import { PanelSkeleton } from './PanelSkeleton';
import { StagePlanListView, type StageAddRequest } from './StagePlanListView';

/**
 * Loads the session-scoped stage list, creates tasks from the add bar, moves
 * them by drag or the move buttons, and opens the existing task drawer.
 * Requests carry only the route client id. The server decides the organization.
 */
export function StagePlanList({ clientId, clientName }: { clientId: string; clientName: string }) {
    const { userId } = useCurrentMember();
    const [query, setQuery] = useState('');
    const [error, setError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [detail, setDetail] = useState<Task | null>(null);
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

    const reload = () => setReloadKey(key => key + 1);

    const addTasks = async (input: StageAddRequest) => {
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
                onReorder={move}
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

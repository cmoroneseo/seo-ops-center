'use client';

import { useEffect, useRef, useState } from 'react';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { parseStageListTasks, type StageListTask } from '@/lib/seo-plan/stage-list';
import { getTask } from '@/lib/supabase/tasks';
import type { Task } from '@/lib/types';
import { PanelSkeleton } from './PanelSkeleton';
import { StagePlanListView } from './StagePlanListView';

/**
 * Loads the session-scoped stage list and opens the existing task drawer.
 * The request carries only the route client id. The server decides the organization.
 */
export function StagePlanList({ clientId, clientName }: { clientId: string; clientName: string }) {
    const { userId } = useCurrentMember();
    const [query, setQuery] = useState('');
    const [tasks, setTasks] = useState<StageListTask[] | null>(null);
    const [error, setError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [detail, setDetail] = useState<Task | null>(null);
    const seenClient = useRef<string | null>(null);

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
                if (!cancelled) setTasks(parseStageListTasks(body?.tasks));
            })
            .catch(() => {
                if (!cancelled) setError(true);
            });
        return () => { cancelled = true; };
    }, [clientId, reloadKey]);

    const reload = () => setReloadKey(key => key + 1);

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

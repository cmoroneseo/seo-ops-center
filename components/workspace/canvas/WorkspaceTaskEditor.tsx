'use client';

import { useEffect, useState } from 'react';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { getTask } from '@/lib/supabase/tasks';
import type { Task } from '@/lib/types';

export function WorkspaceTaskEditor({ taskId, organizationId, clientId, userId, onClose, onChanged }: {
    taskId: string;
    organizationId: string;
    clientId: string;
    userId: string;
    onClose: () => void;
    onChanged: () => void;
}) {
    const [task, setTask] = useState<Task | null>(null);
    const [error, setError] = useState(false);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let cancelled = false;
        setTask(null);
        setError(false);
        getTask(taskId).then(result => {
            if (cancelled) return;
            if (!result.task || result.task.organizationId !== organizationId || result.task.clientId !== clientId) { setError(true); return; }
            setTask(result.task);
        }).catch(() => { if (!cancelled) setError(true); });
        return () => { cancelled = true; };
    }, [taskId, organizationId, clientId, retry]);
    if (!task) return <div className="p-6"><button type="button" onClick={onClose} className="mb-4 rounded-md px-2 py-1 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">Close</button><p role="status" className="text-sm text-muted-foreground">{error ? 'Task details could not be loaded.' : 'Loading task details…'}</p>{error && <button type="button" onClick={() => setRetry(value => value + 1)} className="mt-3 rounded-md border border-border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring">Retry</button>}</div>;
    return <TaskDetailModal key={task.id} task={task} isOpen embedded currentUserId={userId} onClose={onClose} onUpdate={updated => { setTask(updated); onChanged(); }} onDelete={() => { onChanged(); onClose(); }} />;
}

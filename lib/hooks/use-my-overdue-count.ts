'use client';

import { useEffect, useState } from 'react';
import { getTasks } from '@/lib/supabase/tasks';
import { countMyOverdueTasks, localDateKey, TASK_DATA_CHANGED_EVENT } from '@/lib/tasks/my-tasks';

export function useMyOverdueCount(organizationId?: string | null, userId?: string | null): number {
    const [result, setResult] = useState<{ organizationId: string; userId: string; count: number } | null>(null);

    useEffect(() => {
        if (!organizationId || !userId) {
            setResult(null);
            return;
        }

        let latestRequest = 0;
        const load = async () => {
            const request = ++latestRequest;
            const tasks = await getTasks(organizationId, { assigneeId: userId });
            if (request === latestRequest) {
                setResult({ organizationId, userId, count: countMyOverdueTasks(tasks, localDateKey(), userId) });
            }
        };

        void load();
        window.addEventListener('focus', load);
        window.addEventListener(TASK_DATA_CHANGED_EVENT, load);
        return () => {
            latestRequest++;
            window.removeEventListener('focus', load);
            window.removeEventListener(TASK_DATA_CHANGED_EVENT, load);
        };
    }, [organizationId, userId]);

    return result && result.organizationId === organizationId && result.userId === userId ? result.count : 0;
}

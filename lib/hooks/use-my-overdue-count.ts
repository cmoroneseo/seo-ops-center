'use client';

import { useEffect, useState } from 'react';
import { getMyOverdueTaskCount } from '@/lib/supabase/my-overdue-count';
import { localDateKey, TASK_DATA_CHANGED_EVENT } from '@/lib/tasks/my-tasks';

export function useMyOverdueCount(organizationId?: string | null, userId?: string | null): number | null {
    const [result, setResult] = useState<{ organizationId: string; userId: string; count: number } | null>(null);

    useEffect(() => {
        if (!organizationId || !userId) return;

        let latestRequest = 0;
        const load = async () => {
            const request = ++latestRequest;
            try {
                const count = await getMyOverdueTaskCount(organizationId, userId, localDateKey());
                if (request === latestRequest) setResult({ organizationId, userId, count });
            } catch (error) {
                if (request !== latestRequest) return;
                console.error('Error fetching overdue task count:', error);
                setResult(previous => previous?.organizationId === organizationId && previous.userId === userId
                    ? previous
                    : { organizationId, userId, count: 0 });
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

    return result && result.organizationId === organizationId && result.userId === userId ? result.count : null;
}

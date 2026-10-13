import { getMarketingPlan } from '@/lib/supabase/marketing-plans';
import { getTasksByClient } from '@/lib/supabase/tasks';
import type { MarketingPlan, Task } from '@/lib/types';

const COALESCE_MS = 15_000;

const plans = new Map<string, { at: number; pending: Promise<MarketingPlan | null> }>();
const tasks = new Map<string, { at: number; pending: Promise<Task[]> }>();

function cached<T>(map: Map<string, { at: number; pending: Promise<T> }>, key: string, fresh: boolean, load: () => Promise<T>): Promise<T> {
    const hit = map.get(key);
    if (!fresh && hit && Date.now() - hit.at < COALESCE_MS) return hit.pending;
    const pending = load();
    map.set(key, { at: Date.now(), pending });
    void pending.catch(() => {
        const hit = map.get(key);
        if (hit?.pending === pending) map.delete(key);
    });
    return pending;
}

/** Share the plan read that Overview and the roadmap both need. */
export function loadMarketingPlan(clientId: string, fresh = false): Promise<MarketingPlan | null> {
    return cached(plans, clientId, fresh, () => getMarketingPlan(clientId));
}

/** Share the task read Overview starts while the client header is still loading. */
export function loadClientTasks(clientId: string, fresh = false): Promise<Task[]> {
    return cached(tasks, clientId, fresh, () => getTasksByClient(clientId, true));
}

/** Start plan and task reads as soon as the client route is known. */
export function prefetchClientWorkspace(clientId: string): void {
    void loadMarketingPlan(clientId);
    void loadClientTasks(clientId);
}

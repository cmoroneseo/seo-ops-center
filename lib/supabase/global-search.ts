import { createClient } from './client';
import { escapeLikePattern, type OrgSearchHits } from '../dashboard/command-palette';
import { PROJECT_STATUS } from '../projects/project-cards';
import type { TaskStatus } from '../types';

const TASK_STATUS_LABELS = {
    todo: 'To do',
    in_progress: 'In progress',
    done: 'Done',
} satisfies Record<TaskStatus, string>;

interface SearchRow {
    id: string;
    title: string | null;
    client_id: string | null;
    clients: { name: string | null } | null;
}

interface ProjectRow extends SearchRow {
    state: keyof typeof PROJECT_STATUS;
}

interface TaskRow extends SearchRow {
    status: TaskStatus;
}

export async function searchOrgProjectsAndTasks(organizationId: string, query: string): Promise<OrgSearchHits> {
    const trimmed = query.trim();
    if (!organizationId || trimmed.length < 2) return { projects: [], tasks: [] };

    const supabase = createClient();
    if (!supabase) return { projects: [], tasks: [] };

    const pattern = `%${escapeLikePattern(trimmed)}%`;
    const [projects, tasks] = await Promise.all([
        supabase.from('campaign_initiatives')
            .select('id, title, client_id, state, clients(name)')
            .eq('organization_id', organizationId)
            .ilike('title', pattern)
            .limit(6),
        supabase.from('tasks')
            .select('id, title, client_id, status, clients(name)')
            .eq('organization_id', organizationId)
            .is('parent_task_id', null)
            .ilike('title', pattern)
            .limit(6),
    ]);

    return {
        projects: ((projects.data ?? []) as ProjectRow[]).flatMap(row => {
            if (row.client_id == null || row.title == null) return [];
            return [{
                id: row.id,
                clientId: row.client_id,
                title: row.title,
                clientName: row.clients?.name ?? null,
                statusLabel: PROJECT_STATUS[row.state]?.label ?? 'Planned',
            }];
        }),
        tasks: ((tasks.data ?? []) as TaskRow[]).flatMap(row => {
            if (row.title == null) return [];
            return [{
                id: row.id,
                clientId: row.client_id,
                title: row.title,
                clientName: row.clients?.name ?? null,
                statusLabel: TASK_STATUS_LABELS[row.status] ?? 'To do',
            }];
        }),
    };
}

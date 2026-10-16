import type { Task, TaskCategory, TaskPriority, TaskStage, TaskStatus } from '../types';
import { isTaskStage } from './stage';

/**
 * Columns written by a direct tasks insert.
 * createTask and the stage add bar both go through this so a new task gets
 * the same defaults. Stage and position are included only when the caller
 * sets them; other creates keep the database defaults.
 */
export interface TaskCreateFields {
    organizationId?: string;
    projectId?: string;
    clientId?: string;
    title?: string;
    description?: string;
    assigneeIds?: string[];
    watcherIds?: string[];
    dueDate?: string;
    startDate?: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    category?: TaskCategory;
    tags?: string[];
    estimatedHours?: number;
    scheduledMinutes?: number;
    deliverableId?: string;
    parentTaskId?: string;
    sortOrder?: number;
    createdBy?: string;
    templateId?: string;
    recurrence?: Task['recurrence'];
    campaignPhaseId?: string;
    stage?: TaskStage;
    position?: number;
}

export function taskCreateRow(task: TaskCreateFields): Record<string, unknown> {
    return {
        organization_id: task.organizationId,
        project_id: task.projectId,
        client_id: task.clientId,
        title: task.title,
        description: task.description,
        assignee_ids: task.assigneeIds ?? [],
        watcher_ids: task.watcherIds ?? [],
        due_date: task.dueDate,
        start_date: task.startDate,
        priority: task.priority ?? 'medium',
        status: task.status ?? 'todo',
        category: task.category,
        tags: task.tags ?? [],
        estimated_hours: task.estimatedHours,
        scheduled_minutes: task.scheduledMinutes,
        deliverable_id: task.deliverableId,
        parent_task_id: task.parentTaskId,
        sort_order: task.sortOrder ?? 0,
        created_by: task.createdBy,
        template_id: task.templateId,
        recurrence: task.recurrence,
        campaign_phase_id: task.campaignPhaseId ?? null,
        ...(isTaskStage(task.stage) ? { stage: task.stage } : {}),
        ...(typeof task.position === 'number' && Number.isFinite(task.position) ? { position: task.position } : {}),
    };
}

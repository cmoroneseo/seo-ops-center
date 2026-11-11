import type { MapRecordStatus, ProductionStatus } from '../types';
import { approveRecordPatch, productionUpdates, readWorkMonth } from '../topical-map/production';

/**
 * A page gets one task. Approve creates it only when no task is linked yet.
 * A page that was put back to "not written" or declined keeps its task link,
 * so approving it again reuses that task. The month can still be saved.
 */
export function planRecordApproval(record: {
    status: MapRecordStatus;
    taskId?: string | null;
}): { createTask: boolean; taskId: string | null } {
    const taskId = record.taskId?.trim() ?? '';
    if (taskId) return { createTask: false, taskId };
    return { createTask: true, taskId: null };
}

export function approvalUpdate(
    record: { productionStatus?: ProductionStatus | null },
    taskId: string,
    workMonth: string,
): { ok: true; row: Record<string, string | null> } | { ok: false; error: string } {
    const month = readWorkMonth(workMonth);
    if (!month) return { ok: false, error: 'Month needs a real month.' };
    const id = taskId.trim();
    if (!id) return { ok: false, error: 'Could not create the task for this page.' };
    const patch = { ...approveRecordPatch(id, record.productionStatus), workMonth: month };
    const written = productionUpdates(patch);
    if (!written.ok) return written;
    return {
        ok: true,
        row: {
            ...written.row,
            status: 'approved',
            task_id: id,
        },
    };
}

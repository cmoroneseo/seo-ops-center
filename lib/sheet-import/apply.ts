import { SEO_PLAN_LABEL } from '../marketing-plan-template';
import type { PreviewRow } from './csv';
import { buildImportKey, isStepKey, phases, type Phase } from './mapping';

export const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

interface CommonFields {
    client_id: string;
    title: string;
    description: string;
    import_key: string;
}

interface PlanItem extends CommonFields {
    status: 'todo' | 'done';
    roadmap_phase: Phase;
    roadmap_included: true;
    step_key: string;
    priority: 'medium';
    is_custom: true;
    source: 'sheet';
}

interface Task extends CommonFields {
    status: 'todo' | 'done' | 'in_progress';
    category: 'content';
}

export type ApplyPlan = ReturnType<typeof planApply>;

export function planApply(previewRows: PreviewRow[]) {
    const approved = previewRows.filter(row => /^(y|yes)$/i.test(row.approve.trim()) && row.action === 'create');
    const planItems: { clientName: string; payload: PlanItem }[] = [];
    const tasks: Task[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();

    for (const [index, row] of approved.entries()) {
        try {
            if (!uuidPattern.test(row.client_id) || !row.client_name.trim() || !row.title.trim() || !row.description.trim()) {
                throw new Error('Missing or invalid client, title, or description');
            }
            const key = buildImportKey(row.sheet_id, row.sheet_tab, Number(row.sheet_row));
            if (key !== row.import_key || !/^[1-9]\d{0,5}$/.test(row.sheet_row)) throw new Error('Invalid import key');
            const clientId = row.client_id.toLowerCase();
            const identity = `${clientId}:${key}`;
            if (seen.has(identity)) throw new Error('Duplicate approved import key');
            const payload = { client_id: clientId, title: row.title, description: row.description, import_key: key };
            const status = row.status;
            if (row.sheet_tab === 'Roadmap' && row.target_table === 'marketing_plan_items') {
                const phase = phases.find(value => value === row.roadmap_phase);
                if (!phase || !isStepKey(row.step_key) || (status !== 'todo' && status !== 'done')) {
                    throw new Error('Invalid plan item phase, step key, or status');
                }
                planItems.push({ clientName: row.client_name, payload: {
                    ...payload, status, roadmap_phase: phase, roadmap_included: true,
                    step_key: row.step_key, priority: 'medium', is_custom: true, source: 'sheet',
                } });
            } else if (row.sheet_tab === 'Content Plan' && row.target_table === 'tasks') {
                if (row.category !== 'content'
                    || (status !== 'todo' && status !== 'done' && status !== 'in_progress')) {
                    throw new Error('Invalid task category or status');
                }
                tasks.push({ ...payload, status, category: 'content' });
            } else {
                throw new Error('Invalid sheet tab and target table combination');
            }
            seen.add(identity);
        } catch (error) {
            errors.push(`Approved entry ${index + 1}: ${(error as Error).message}`);
        }
    }
    return { approvedCount: approved.length, planItems, tasks, errors };
}

type ExistingKeys = { planItems: readonly string[]; tasks: readonly string[] };
export type PlanItemInsert = PlanItem & { marketing_plan_id: string; sort_order: number };
export type TaskInsert = Task;

export interface ImportDeps {
    findExistingImportKeys(clientId: string, keys: string[]): Promise<ExistingKeys>;
    findPlan?(clientId: string): Promise<string | null>;
    getOrCreatePlan(clientId: string, title: string): Promise<string>;
    maxSortOrder(planId: string): Promise<number | null>;
    insertPlanItems(rows: PlanItemInsert[]): Promise<number>;
    insertTasks(rows: TaskInsert[]): Promise<number>;
}

export async function applyImport(plan: ApplyPlan, deps: ImportDeps, { execute = false } = {}) {
    if (plan.errors.length) throw new Error(plan.errors.join('\n'));
    const result = {
        inserted: 0, skipped: 0,
        planItems: [] as (PlanItem & { marketing_plan_id?: string; sort_order?: number })[],
        tasks: [] as TaskInsert[],
    };
    const clientIds = new Set([...plan.planItems.map(({ payload }) => payload.client_id), ...plan.tasks.map(row => row.client_id)]);
    for (const clientId of clientIds) {
        const items = plan.planItems.filter(({ payload }) => payload.client_id === clientId);
        const tasks = plan.tasks.filter(row => row.client_id === clientId);
        const existing = await deps.findExistingImportKeys(clientId, [
            ...items.map(({ payload }) => payload.import_key), ...tasks.map(row => row.import_key),
        ]);
        const pendingItems = items.filter(({ payload }) => !existing.planItems.includes(payload.import_key));
        const pendingTasks = tasks.filter(row => !existing.tasks.includes(row.import_key));
        result.skipped += items.length + tasks.length - pendingItems.length - pendingTasks.length;

        if (pendingItems.length) {
            const title = `${pendingItems[0].clientName} — ${SEO_PLAN_LABEL}`;
            const planId = execute
                ? await deps.getOrCreatePlan(clientId, title)
                : await deps.findPlan?.(clientId);
            if (planId) {
                const max = await deps.maxSortOrder(planId);
                const rows = pendingItems.map(({ payload }, index) => ({
                    ...payload, marketing_plan_id: planId, sort_order: (max ?? -1) + index + 1,
                }));
                if (rows[rows.length - 1].sort_order > 32767) throw new Error('Plan item sort order exceeds database limit');
                result.planItems.push(...rows);
                if (execute) result.inserted += await deps.insertPlanItems(rows);
            } else {
                result.planItems.push(...pendingItems.map(({ payload }) => payload));
            }
        }
        result.tasks.push(...pendingTasks);
        if (execute && pendingTasks.length) result.inserted += await deps.insertTasks(pendingTasks);
    }
    if (execute) result.skipped = plan.approvedCount - result.inserted;
    return result;
}

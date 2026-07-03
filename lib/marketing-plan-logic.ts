import type {
    MarketingPlanItem, MarketingPlanStep,
    MarketingPlanItemPriority, MarketingPlanItemStatus,
} from './types';

export interface PlanSummary {
    total: number;
    done: number;
    todo: number;
    ignored: number;
    progressPercent: number;
    priorityCounts: { high: number; medium: number; low: number };
}

export function computePlanSummary(items: MarketingPlanItem[]): PlanSummary {
    const total = items.length;
    const done = items.filter(i => i.status === 'done').length;
    const ignored = items.filter(i => i.status === 'ignored').length;
    const todo = total - done - ignored;
    const denominator = total - ignored;
    const progressPercent = denominator === 0 ? 0 : Math.round((done / denominator) * 100);
    const active = items.filter(i => i.status !== 'ignored');
    const priorityCounts = {
        high: active.filter(i => i.priority === 'high').length,
        medium: active.filter(i => i.priority === 'medium').length,
        low: active.filter(i => i.priority === 'low').length,
    };
    return { total, done, todo, ignored, progressPercent, priorityCounts };
}

export type GroupMode = 'step' | 'priority' | 'status';

export interface ItemGroup {
    key: string;
    label: string;
    items: MarketingPlanItem[];
}

const PRIORITY_ORDER: { key: MarketingPlanItemPriority; label: string }[] = [
    { key: 'high', label: 'High' },
    { key: 'medium', label: 'Medium' },
    { key: 'low', label: 'Low' },
];

const STATUS_ORDER: { key: MarketingPlanItemStatus; label: string }[] = [
    { key: 'todo', label: 'To Do' },
    { key: 'done', label: 'Done' },
    { key: 'ignored', label: 'Ignored' },
];

export function groupItems(
    items: MarketingPlanItem[],
    steps: MarketingPlanStep[],
    mode: GroupMode,
): ItemGroup[] {
    const bySort = (a: MarketingPlanItem, b: MarketingPlanItem) => a.sortOrder - b.sortOrder;

    if (mode === 'step') {
        return [...steps]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(s => ({
                key: s.key,
                label: s.name,
                items: items.filter(i => i.stepKey === s.key).sort(bySort),
            }));
    }
    if (mode === 'priority') {
        return PRIORITY_ORDER
            .map(p => ({
                key: p.key,
                label: p.label,
                items: items.filter(i => i.priority === p.key).sort(bySort),
            }))
            .filter(g => g.items.length > 0);
    }
    return STATUS_ORDER
        .map(s => ({
            key: s.key,
            label: s.label,
            items: items.filter(i => i.status === s.key).sort(bySort),
        }))
        .filter(g => g.items.length > 0);
}

export function filterItems(items: MarketingPlanItem[], query: string): MarketingPlanItem[] {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i =>
        i.title.toLowerCase().includes(q) ||
        (i.description ?? '').toLowerCase().includes(q),
    );
}

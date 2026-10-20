import { formatHourAmount } from '@/lib/hour-format';
import { isInRoadmap } from '@/lib/marketing-plan-roadmap';
import type { MarketingPlanItem, ProjectStatus } from '@/lib/types';

export type HoursNarrative = 'prelaunch' | 'monthly' | 'custom' | 'unavailable';

export interface PlanHourInput {
    seoHours?: number | null;
    scopeMode?: 'monthly' | 'custom';
    status: ProjectStatus | string;
    launchDate?: string | null;
    month: string;
}

const OPEN_TASK = new Set(['done']);

/** Library rows stay out. Only selected Onboarding roadmap items count. */
export function onboardingProgress(items: MarketingPlanItem[]): { done: number; total: number; items: MarketingPlanItem[] } {
    const rows = items.filter(item => isInRoadmap(item) && item.status !== 'ignored' && (item.roadmapPhase ?? 'backlog') === 'onboarding');
    return {
        done: rows.filter(item => item.status === 'done').length,
        total: rows.length,
        items: rows,
    };
}

/** Undated open tasks need a date. They do not count as due in a month. */
export function taskDateCounts(
    tasks: Array<{ dueDate?: string | null; status: string }>,
    month: string,
): { due: number; needDate: number } {
    const open = tasks.filter(task => !OPEN_TASK.has(task.status));
    const dated = (task: { dueDate?: string | null }) => {
        const value = task.dueDate?.slice(0, 10) ?? '';
        return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
    };
    return {
        due: open.filter(task => dated(task).slice(0, 7) === month).length,
        needDate: open.filter(task => !dated(task)).length,
    };
}

export function engagementHasStarted(input: Pick<PlanHourInput, 'status' | 'launchDate' | 'month'>): boolean {
    const launch = input.launchDate?.slice(0, 10) ?? '';
    return input.status === 'Active' && /^\d{4}-\d{2}-\d{2}$/.test(launch) && input.month >= launch.slice(0, 7);
}

/** Missing and pre-launch hours never render as 0. Custom scope stays a label, not a monthly quota. */
export function planHourLabel(input: PlanHourInput): string {
    if (!engagementHasStarted(input)) return 'Hours start after launch';
    if (input.scopeMode === 'custom') return 'Custom scope';
    if (input.seoHours == null || !Number.isFinite(input.seoHours) || input.seoHours <= 0) return '—';
    return `${formatHourAmount(input.seoHours)}h/mo`;
}

export function planHoursNarrative(input: PlanHourInput): HoursNarrative {
    if (!engagementHasStarted(input)) return 'prelaunch';
    if (input.scopeMode === 'custom') return 'custom';
    if (input.seoHours != null && Number.isFinite(input.seoHours) && input.seoHours > 0) return 'monthly';
    return 'unavailable';
}

/** Schedule dialog copy. Failed and pre-launch states do not invent an allowance. */
export function scheduleHoursNote(narrative: HoursNarrative, budget: number, remaining: number, effort: number): string {
    if (narrative === 'prelaunch') return 'These hours start after launch.';
    if (narrative === 'custom') return 'Custom scope. These hours are not a monthly allowance.';
    if (narrative === 'unavailable') return '—';
    if (!(budget > 0) || !Number.isFinite(budget) || !Number.isFinite(remaining) || !Number.isFinite(effort)) return '—';
    if (effort > remaining) return `This puts the plan ${formatHourAmount(effort - remaining)}h over budget. You can still schedule it.`;
    return `${formatHourAmount(remaining - effort)}h available after scheduling.`;
}

export function planSurfaceViews(v2: boolean): Array<{ id: 'month' | 'roadmap' | 'full' | 'results'; label: string }> {
    return v2
        ? [{ id: 'month', label: 'This month' }, { id: 'roadmap', label: 'Roadmap' }]
        : [{ id: 'month', label: 'This month' }, { id: 'full', label: 'Full plan' }, { id: 'results', label: 'Results' }];
}

const UNASSIGNED = new Set(['', 'unassigned', 'none', 'n/a']);

export function managerIsAssigned(name: string | null | undefined): boolean {
    return !UNASSIGNED.has((name ?? '').trim().toLowerCase());
}

import type { MarketingPlanItem } from './types';

export const ROADMAP_PHASES = [
    ['onboarding', 'Onboarding'], ['month_1', 'Month 1'],
    ['month_2', 'Month 2'], ['month_3', 'Month 3'], ['backlog', 'Backlog'],
] as const;
export type RoadmapPhase = typeof ROADMAP_PHASES[number][0];

/** Existing ignored items stay excluded; execution status remains independent. */
export function isInRoadmap(item: MarketingPlanItem): boolean {
    return item.roadmapIncluded ?? item.status !== 'ignored';
}
export function roadmapItemsForPhase(items: MarketingPlanItem[], phase: RoadmapPhase): MarketingPlanItem[] {
    return items.filter(item => isInRoadmap(item) && (item.roadmapPhase ?? 'backlog') === phase);
}

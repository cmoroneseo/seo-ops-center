import { MARKETING_PLAN_TEMPLATE_ITEMS } from '../marketing-plan-template';
import type { MarketingPlanItemPriority } from '../types';

/** Stored on marketing_plan_items.source. Migration 087. */
export const PLAN_ITEM_SOURCES = ['template', 'onboarding', 'custom', 'basecamp'] as const;
export type PlanItemSource = (typeof PLAN_ITEM_SOURCES)[number];

/** One checklist row replaces separate Search Console and GA4 items. */
export const CONNECT_ANALYTICS_KEY = 'access.analytics';
export const CONNECT_ANALYTICS_TITLE = 'Connect GA4 and Search Console';

export interface OnboardingChecklistItem {
    templateKey: string;
    title: string;
    stepKey: string;
    description: string;
    priority: MarketingPlanItemPriority;
    /** Omitted items are always included. GBP and listings follow setup scope. */
    when?: 'gbp' | 'listings';
}

export interface SeededOnboardingItem {
    stepKey: string;
    title: string;
    description: string;
    priority: MarketingPlanItemPriority;
    included: true;
    phase: 'onboarding';
    custom: false;
    templateKey: string;
    source: 'onboarding';
}

/**
 * Canonical onboarding checklist. Keys are stable.
 * Search Console and GA4 are one item, per Carlos (Oct 13, 2026).
 * "Add Project to SEO platform" is internal and is not a plan item.
 */
export const ONBOARDING_CHECKLIST: readonly OnboardingChecklistItem[] = [
    {
        templateKey: 'access.cms',
        title: 'Confirm website and CMS access',
        stepKey: 'setup',
        priority: 'high',
        description: 'Collect admin credentials for the website and CMS. Confirm pages, templates, and redirects can be edited.',
    },
    {
        templateKey: CONNECT_ANALYTICS_KEY,
        title: CONNECT_ANALYTICS_TITLE,
        stepKey: 'setup',
        priority: 'high',
        description: 'Connect Google Analytics 4 and Search Console. Confirm the agency account can read traffic and search data.',
    },
    {
        templateKey: 'access.portal',
        title: 'Connect Search Console and Analytics in the client portal',
        stepKey: 'setup',
        priority: 'high',
        description: 'Connect Search Console and Analytics in the client portal so the client can see the same properties.',
    },
    {
        templateKey: 'tracking.consent',
        title: 'Set up consent and Empire Cookies',
        stepKey: 'setup',
        priority: 'high',
        description: 'Set up consent and Empire Cookies before measurement is treated as complete.',
    },
    {
        templateKey: 'tracking.rank',
        title: 'Add keywords to rank tracking',
        stepKey: 'setup',
        priority: 'high',
        description: 'Add the client’s target keywords to rank tracking and confirm the first snapshot is recording.',
    },
    {
        templateKey: 'strategy.roadmap',
        title: 'Create the SEO roadmap and recommendations',
        stepKey: 'setup',
        priority: 'high',
        description: 'Create the SEO roadmap and the recommendations list for this engagement.',
    },
    {
        templateKey: 'kickoff.call',
        title: 'Hold the kickoff and confirm the agreement',
        stepKey: 'setup',
        priority: 'high',
        description: 'Hold the kickoff and confirm the agreement, timeline, and communication cadence.',
    },
    {
        templateKey: 'local.gbp',
        title: 'Complete initial Google Business Profile setup',
        stepKey: 'local',
        priority: 'high',
        description: 'Complete the initial Google Business Profile setup. Included only when GBP is in scope.',
        when: 'gbp',
    },
    {
        templateKey: 'local.listings',
        title: 'Activate directory listings',
        stepKey: 'local',
        priority: 'high',
        description: 'Activate directory listings and verify the business information. Included only when listings are in scope.',
        when: 'listings',
    },
];

/** Titles already used on older setups. They share a key so the catalog cannot insert a second copy. */
const LEGACY_TITLES: Record<string, readonly string[]> = {
    'strategy.roadmap': ['Prepare SEO strategy and roadmap'],
    'local.gbp': ['Complete initial GBP optimization'],
    'local.listings': ['Activate directory listings and verify business information'],
};

export function onboardingChecklist(scope: { gbp?: boolean; listings?: boolean }): OnboardingChecklistItem[] {
    return ONBOARDING_CHECKLIST.filter(item => {
        if (item.when === 'gbp') return scope.gbp === true;
        if (item.when === 'listings') return scope.listings === true;
        return true;
    });
}

export function onboardingSeedItems(scope: { gbp?: boolean; listings?: boolean }): SeededOnboardingItem[] {
    return onboardingChecklist(scope).map(item => ({
        stepKey: item.stepKey,
        title: item.title,
        description: item.description,
        priority: item.priority,
        included: true,
        phase: 'onboarding',
        custom: false,
        templateKey: item.templateKey,
        source: 'onboarding',
    }));
}

export function titlesForTemplateKey(templateKey: string): string[] {
    const titles = new Set<string>();
    for (const item of ONBOARDING_CHECKLIST) {
        if (item.templateKey === templateKey) titles.add(item.title);
    }
    for (const item of MARKETING_PLAN_TEMPLATE_ITEMS) {
        if (item.templateKey === templateKey) titles.add(item.title);
    }
    for (const title of LEGACY_TITLES[templateKey] ?? []) titles.add(title);
    return [...titles];
}

/** True when this catalog row would be a second copy of work already on the plan. */
export function catalogAddBlocked(
    existing: Array<{ templateKey?: string | null; title: string }>,
    candidate: { templateKey?: string | null; title: string },
): boolean {
    const title = candidate.title.trim();
    if (existing.some(item => item.title.trim() === title)) return true;
    const key = candidate.templateKey?.trim();
    if (!key) return false;
    const covered = new Set(titlesForTemplateKey(key));
    return existing.some(item => item.templateKey?.trim() === key || covered.has(item.title.trim()));
}

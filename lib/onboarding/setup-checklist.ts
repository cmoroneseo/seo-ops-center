/**
 * Client setup list. Each step is done only from stored state.
 * Unknown reads stay unknown so a failed load is not shown as "not done".
 */

import { normalizeSeedKeywords } from '../topical-map/seed-keywords';

export const SETUP_STEP_ORDER = [
    'details',
    'brand',
    'competitors',
    'keywords',
    'search-console',
    'topic-map',
    'plan',
] as const;

export type SetupStepId = (typeof SETUP_STEP_ORDER)[number];

export type WizardSetupStep = 'profile' | 'seeds' | 'keywords' | 'confirm';

const LABELS: Record<SetupStepId, string> = {
    details: 'Add client details',
    brand: 'Confirm brand',
    competitors: 'Competitors',
    keywords: 'Keywords',
    'search-console': 'Connect Search Console',
    'topic-map': 'Build topic map',
    plan: 'Build plan',
};

export interface SetupChecklistFacts {
    clientName: string;
    website: string | null;
    /** Null when the brand profile could not be read. */
    brandName: string | null;
    businessDescription: string | null;
    competitors: readonly string[] | null;
    keywords: readonly string[] | null;
    searchConsoleConnected: boolean | null;
    topicMapBuilt: boolean | null;
    marketingPlanItemCount: number | null;
    initiativeCount: number | null;
}

export interface SetupStepView {
    id: SetupStepId;
    label: string;
    done: boolean | null;
    href: string;
}

function filled(value: string | null | undefined): boolean {
    return Boolean(value && value.trim());
}

export function clientDetailsDone(name: string, website: string | null | undefined): boolean {
    return filled(name) && filled(website);
}

export function brandConfirmed(brandName: string, description: string): boolean {
    return filled(brandName) && filled(description);
}

export function competitorsAdded(rivals: readonly string[]): boolean {
    return rivals.some(rival => filled(rival));
}

export function keywordsChosen(keywords: readonly string[]): boolean {
    return normalizeSeedKeywords(keywords).length > 0;
}

export function searchConsoleConnectedFromIntegration(
    integration: { syncStatus?: string; selectedProperty?: string | null; needsPropertySetup?: boolean } | null | undefined | 'unknown',
): boolean | null {
    if (integration === 'unknown') return null;
    if (!integration) return false;
    if (integration.needsPropertySetup) return false;
    if (integration.syncStatus !== 'active') return false;
    return filled(integration.selectedProperty);
}

export function topicMapBuiltFrom(input: {
    status: 'missing' | 'unknown' | 'present';
    stages?: readonly string[];
    recordCount?: number;
}): boolean | null {
    if (input.status === 'unknown') return null;
    if (input.status === 'missing') return false;
    return (input.stages ?? []).includes('complete') || (input.recordCount ?? 0) > 0;
}

/** A plan row with no tasks, and no campaign initiatives, is not built yet. */
export function planBuilt(itemCount: number | null, initiativeCount: number | null): boolean | null {
    if ((itemCount ?? 0) > 0 || (initiativeCount ?? 0) > 0) return true;
    if (itemCount == null || initiativeCount == null) return null;
    return false;
}

export function generationStages(metadata: unknown): string[] {
    if (!metadata || typeof metadata !== 'object') return [];
    const meta = metadata as Record<string, unknown>;
    const raw = meta.stagesCompleted ?? meta.stages_completed;
    if (!Array.isArray(raw)) return [];
    return raw.filter((stage): stage is string => typeof stage === 'string');
}

export function wizardStepForSetup(value: string | null): WizardSetupStep | null {
    switch (value) {
        case 'brand':
            return 'profile';
        case 'competitors':
            return 'seeds';
        case 'keywords':
            return 'keywords';
        case 'generate':
            return 'confirm';
        default:
            return null;
    }
}

export function setupChecklistStorageKey(clientId: string): string {
    return `seo-ops.setup-checklist.dismissed.${clientId}`;
}

function workspaceHref(clientId: string, query: string): string {
    return `/workspace/${encodeURIComponent(clientId)}?${query}`;
}

export function setupStepHref(clientId: string, step: SetupStepId, campaignWorkspace: boolean): string {
    switch (step) {
        case 'details':
            return workspaceHref(clientId, 'tab=overview&setup=details');
        case 'brand':
            return workspaceHref(clientId, 'tab=topical-map&setup=brand');
        case 'competitors':
            return workspaceHref(clientId, 'tab=topical-map&setup=competitors');
        case 'keywords':
            return workspaceHref(clientId, 'tab=topical-map&setup=keywords');
        case 'search-console':
            return workspaceHref(clientId, 'tab=integrations&setup=search-console');
        case 'topic-map':
            return workspaceHref(clientId, 'tab=topical-map&setup=generate');
        case 'plan':
            return workspaceHref(clientId, campaignWorkspace ? 'tab=campaign-workspace' : 'tab=campaign');
    }
}

export function deriveSetupChecklist(
    facts: SetupChecklistFacts,
    options: { clientId: string; campaignWorkspace: boolean },
): SetupStepView[] {
    const done: Record<SetupStepId, boolean | null> = {
        details: clientDetailsDone(facts.clientName, facts.website),
        brand: facts.brandName == null || facts.businessDescription == null
            ? null
            : brandConfirmed(facts.brandName, facts.businessDescription),
        competitors: facts.competitors == null ? null : competitorsAdded(facts.competitors),
        keywords: facts.keywords == null ? null : keywordsChosen(facts.keywords),
        'search-console': facts.searchConsoleConnected,
        'topic-map': facts.topicMapBuilt,
        plan: planBuilt(facts.marketingPlanItemCount, facts.initiativeCount),
    };
    return SETUP_STEP_ORDER.map(id => ({
        id,
        label: LABELS[id],
        done: done[id],
        href: setupStepHref(options.clientId, id, options.campaignWorkspace),
    }));
}

export function setupChecklistVisible(steps: readonly { done: boolean | null }[], dismissed: boolean): boolean {
    if (dismissed) return false;
    if (steps.length === 0) return false;
    return steps.some(step => step.done !== true);
}

export type SetupChecklistPanel = 'hidden' | 'loading' | 'unavailable' | 'list';

export function setupChecklistPanel(input: {
    status: 'loading' | 'failed' | 'ready';
    steps: readonly { done: boolean | null }[];
    dismissed: boolean;
}): SetupChecklistPanel {
    if (input.dismissed) return 'hidden';
    if (input.status === 'loading') return 'loading';
    if (input.status === 'failed') return 'unavailable';
    if (!setupChecklistVisible(input.steps, false)) return 'hidden';
    return 'list';
}

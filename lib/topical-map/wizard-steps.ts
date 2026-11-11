/**
 * The four steps of building a topic map, shown as a stepper on the full page.
 * A step reads Done only when its data is saved, so jumping straight to a later
 * step never marks an empty earlier one as done.
 */

export const WIZARD_STEPS = ['profile', 'seeds', 'keywords', 'confirm'] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export type WizardStepStatus = 'done' | 'current' | 'todo';

export interface WizardStepperItem {
    id: WizardStep;
    label: string;
    status: WizardStepStatus;
    statusLabel: string;
}

const LABELS: Record<WizardStep, string> = {
    profile: 'Brand',
    seeds: 'Competitors',
    keywords: 'Keywords',
    confirm: 'Review and build',
};

const STATUS_LABELS: Record<WizardStepStatus, string> = {
    done: 'Done',
    current: 'Current step',
    todo: 'Not started',
};

export function wizardStepperItems(input: {
    current: WizardStep;
    brandDone: boolean;
    competitorsDone: boolean;
    keywordsDone: boolean;
}): WizardStepperItem[] {
    const done: Record<WizardStep, boolean> = {
        profile: input.brandDone,
        seeds: input.competitorsDone,
        keywords: input.keywordsDone,
        confirm: false,
    };
    return WIZARD_STEPS.map(id => {
        const status: WizardStepStatus = id === input.current ? 'current' : done[id] ? 'done' : 'todo';
        return { id, label: LABELS[id], status, statusLabel: STATUS_LABELS[status] };
    });
}

/** The primary button label on each step. */
export function continueLabel(step: WizardStep, selectedKeywords: number): string {
    if (step === 'keywords') return `Continue with ${selectedKeywords} ${selectedKeywords === 1 ? 'keyword' : 'keywords'}`;
    if (step === 'confirm') return 'Build topic map';
    return 'Continue';
}

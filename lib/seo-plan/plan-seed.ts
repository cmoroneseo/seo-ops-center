import { MARKETING_PLAN_TEMPLATE_ITEMS } from '../marketing-plan-template';
import { onboardingSeedItems } from './onboarding';

/** A person chooses one of these. Creating a client or a plan does not. */
export type PlanSeedChoice = 'library' | 'onboarding';

export interface PlanSeedInsert {
    marketing_plan_id: string;
    organization_id: string;
    client_id: string;
    step_key: string;
    title: string;
    description: string;
    priority: string;
    sort_order: number;
    is_custom?: boolean;
    roadmap_included?: boolean;
    roadmap_phase?: string;
    template_key?: string;
    source?: string;
}

/**
 * Rows for an explicit "add the saved list" action.
 * Omitted fields match the previous insert, including database defaults.
 */
export function planSeedInserts(input: {
    seed: PlanSeedChoice;
    marketingPlanId: string;
    organizationId: string;
    clientId: string;
    scope?: { gbp?: boolean; listings?: boolean };
}): PlanSeedInsert[] {
    if (input.seed === 'onboarding') {
        return onboardingSeedItems({
            gbp: input.scope?.gbp === true,
            listings: input.scope?.listings === true,
        }).map((item, index) => ({
            marketing_plan_id: input.marketingPlanId,
            organization_id: input.organizationId,
            client_id: input.clientId,
            step_key: item.stepKey,
            title: item.title,
            description: item.description,
            priority: item.priority,
            sort_order: index,
            is_custom: false,
            roadmap_included: true,
            roadmap_phase: 'onboarding',
            template_key: item.templateKey,
            source: 'onboarding',
        }));
    }
    return MARKETING_PLAN_TEMPLATE_ITEMS.map((item, index) => ({
        marketing_plan_id: input.marketingPlanId,
        organization_id: input.organizationId,
        client_id: input.clientId,
        step_key: item.stepKey,
        title: item.title,
        description: item.description,
        priority: item.priority,
        sort_order: index,
    }));
}

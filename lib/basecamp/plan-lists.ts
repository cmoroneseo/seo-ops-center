/**
 * A client has two Basecamp to-do lists.
 *
 * `basecamp_todolist_id` is the SEO Plan list: the only place new scheduled
 * or promoted work is pushed. Clients that were bound before the split keep
 * that single id, and it remains the push target.
 *
 * `basecamp_onboarding_todolist_id` is the setup list (often "Set up SEO
 * campaign"). It is imported and then added to the SEO Plan. Nothing pushes
 * there.
 */

export const BASECAMP_SEO_PLAN_TODOLIST_KEY = 'basecamp_todolist_id';
export const BASECAMP_ONBOARDING_TODOLIST_KEY = 'basecamp_onboarding_todolist_id';

export interface BasecampPlanLists {
    projectId: string;
    /** Push destination. Empty when the client has not chosen an SEO Plan list. */
    seoPlanTodolistId: string;
    /** Import source. Empty when the client has not chosen an onboarding list. */
    onboardingTodolistId: string;
}

function idString(value: unknown): string {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const normalized = String(value).trim();
    return /^\d+$/.test(normalized) ? normalized : '';
}

export function readBasecampPlanLists(fields: Record<string, unknown> | null | undefined): BasecampPlanLists {
    const source = fields ?? {};
    return {
        projectId: idString(source.basecamp_project_id),
        seoPlanTodolistId: idString(source[BASECAMP_SEO_PLAN_TODOLIST_KEY]),
        onboardingTodolistId: idString(source[BASECAMP_ONBOARDING_TODOLIST_KEY]),
    };
}

/** The list id push must use. Never the onboarding list. */
export function seoPlanPushTodolistId(fields: Record<string, unknown> | null | undefined): string {
    return readBasecampPlanLists(fields).seoPlanTodolistId;
}

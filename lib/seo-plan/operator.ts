export type SeoPlanRole = 'owner' | 'admin' | 'member' | 'viewer';

/**
 * Who may operate an SEO plan.
 *
 * Carlos (Oct 13, 2026): every SEO admin is a main operator. Owners stay
 * operators. `can_manage_integrations` stays an operator, including a member
 * who already has that permission.
 *
 * Org role `admin` is the SEO admin. This predicate does not call Basecamp.
 * Schedule-and-push stays on the existing integration route until a later flag.
 */
export function isSeoPlanOperator(role: SeoPlanRole, canManageIntegrations = false): boolean {
    if (role === 'owner' || role === 'admin') return true;
    return canManageIntegrations === true;
}

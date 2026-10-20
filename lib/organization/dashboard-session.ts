import type { Organization, OrganizationMember } from '@/lib/types';
import { DEFAULT_THEME, type OrganizationTheme } from '@/lib/theme/palette';
import { pickSessionOrganization } from '@/lib/reports/session-org';

export interface DashboardSession {
    organization: Organization | null;
    memberships: OrganizationMember[];
    theme: OrganizationTheme;
}

/**
 * The same membership the client would pick: the selected-organization cookie
 * when it is one of this user's rows, otherwise the oldest membership.
 */
export function dashboardSessionFromMemberships(
    members: readonly OrganizationMember[],
    selectedId: string | null,
): DashboardSession {
    const memberships = members.filter(member => member.organization);
    const picked = pickSessionOrganization(memberships, selectedId);
    const organization = picked?.organization ?? null;
    return {
        organization,
        memberships,
        theme: organization?.theme ?? DEFAULT_THEME,
    };
}

import { clientManagerId, type ManagerIdentity } from '@/lib/workspace/client-managers';

/**
 * One label per person.
 * A stored account_manager_id uses that member's full name, so "Carlos" and
 * "Carlos Morones" collapse when they point at the same user. A legacy row
 * with no id keeps its text unless exactly one member's first name matches.
 */
export function dashboardManagerLabel(
    storedName: string | null | undefined,
    storedId: string | null | undefined,
    members: readonly ManagerIdentity[],
): string | null {
    const stored = storedName?.trim() ?? '';
    const id = clientManagerId(
        { accountManager: stored || 'Unassigned', accountManagerId: storedId ?? undefined },
        [...members],
    );
    if (id) {
        const name = members.find(member => member.id === id)?.name?.trim();
        if (name) return name;
    }
    return stored || null;
}

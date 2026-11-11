/** Owners, admins, and members can log or remove a change. Viewers can only look. */
export function canEditChangeLog(role: string | null | undefined): boolean {
    return role === 'owner' || role === 'admin' || role === 'member';
}

export const CHANGE_LOG_READ_ONLY = 'You can view the change log, not edit it.';

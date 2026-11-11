/** Owners, admins, and members can plan content. Viewers can only look. */
export function canEditContent(role: string | null | undefined): boolean {
    return role === 'owner' || role === 'admin' || role === 'member';
}

export const CONTENT_READ_ONLY = 'You can view this content, not change it.';

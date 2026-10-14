import type { ProjectStatus } from '@/lib/types';

/** Cancelled is the archived client state ("Cancelled (Archived)" in the workspace). */
export function seoPlanReadOnly(status: ProjectStatus | string | null | undefined): boolean {
    return status === 'Cancelled' || status === 'Archived';
}

export const SEO_PLAN_READ_ONLY_NOTE = 'This client is archived. The plan is read-only.';

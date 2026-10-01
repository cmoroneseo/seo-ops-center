import type { ProjectStatus } from '../types';

export type ClientStatusFilter = ProjectStatus | 'Current' | 'All';

export const DEFAULT_CLIENT_STATUS_FILTER: ClientStatusFilter = 'Current';

export function matchesClientStatus(status: ProjectStatus, filter: ClientStatusFilter): boolean {
    if (filter === 'All') return true;
    if (filter === 'Current') return status === 'Active' || status === 'Onboarding';
    return status === filter;
}

export interface SiloVisibilityFilters {
    action: string;
    pageType: string;
    status: string;
}

export function selectVisibleSilos<T extends { id: string }>(
    silos: T[],
    records: Array<{ siloId: string }>,
    activeSiloId: string,
    filters: SiloVisibilityFilters,
    specEnabled: boolean,
): T[] {
    const unfiltered = activeSiloId === 'all'
        && filters.action === 'all'
        && filters.pageType === 'all'
        && filters.status === 'all';
    if (specEnabled && unfiltered) return silos;

    const matched = silos.filter(silo => records.some(record => record.siloId === silo.id));
    if (!specEnabled || activeSiloId === 'all' || matched.some(silo => silo.id === activeSiloId)) {
        return matched;
    }
    const active = silos.find(silo => silo.id === activeSiloId);
    return active ? [...matched, active] : matched;
}

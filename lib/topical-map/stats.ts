import type { TopicalMapRecord, PageType } from '../types';

export interface MapStats {
    totalRecords: number;
    totalDemand: number;
    pillarCount: number;
    existingCount: number;
    plannedLinks: number;
    approvedCount: number;
    declinedCount: number;
}

export interface SiloStats {
    totalRecords: number;
    totalDemand: number;
    approvedCount: number;
    byPageType: Partial<Record<PageType, number>>;
}

export function computeMapStats(records: TopicalMapRecord[]): MapStats {
    let totalDemand = 0;
    let pillarCount = 0;
    let existingCount = 0;
    let plannedLinks = 0;
    let approvedCount = 0;
    let declinedCount = 0;

    for (const r of records) {
        totalDemand += r.searchVolumeMonthly ?? 0;
        if (r.pageType === 'pillar') pillarCount++;
        if (r.sitePageId) existingCount++;
        plannedLinks += r.outgoingLinks.length;
        if (r.status === 'approved') approvedCount++;
        if (r.status === 'declined') declinedCount++;
    }

    return {
        totalRecords: records.length,
        totalDemand,
        pillarCount,
        existingCount,
        plannedLinks,
        approvedCount,
        declinedCount,
    };
}

export function computeSiloStats(records: TopicalMapRecord[], siloId: string): SiloStats {
    const siloRecords = records.filter(r => r.siloId === siloId);
    const byPageType: Partial<Record<PageType, number>> = {};
    let totalDemand = 0;
    let approvedCount = 0;

    for (const r of siloRecords) {
        byPageType[r.pageType] = (byPageType[r.pageType] ?? 0) + 1;
        totalDemand += r.searchVolumeMonthly ?? 0;
        if (r.status === 'approved') approvedCount++;
    }

    return { totalRecords: siloRecords.length, totalDemand, approvedCount, byPageType };
}

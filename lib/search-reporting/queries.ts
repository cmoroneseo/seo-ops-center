import { filterOverlapCandidates, filterPageCandidates, filterRankingCandidates, type Candidate, type OverlapCandidate, type PageCandidate } from '@/lib/gsc/insights';
import { sumMetrics } from './metrics';
import type { InvestigationRow, PositionBand, ReportingSurface, SurfaceInvestigations } from './types';

export const POSITION_BANDS: { id: string; label: string; min: number; max: number }[] = [
    { id: '1-3', label: '1–3', min: 1, max: 3 },
    { id: '4-10', label: '4–10', min: 4, max: 10 },
    { id: '11-20', label: '11–20', min: 11, max: 20 },
    { id: '21-50', label: '21–50', min: 21, max: 50 },
    { id: '51+', label: '51+', min: 51, max: Number.POSITIVE_INFINITY },
];

interface QueryPageFact {
    query: string;
    page: string;
    surface: ReportingSurface;
    date: string;
    clicks: number;
    impressions: number;
    position: number;
}

interface Group {
    query: string;
    page: string;
    surface: ReportingSurface;
    clicks: number;
    impressions: number;
    positionSum: number;
    days: Set<string>;
}

function groupQueryPages(facts: QueryPageFact[]): Group[] {
    const groups = new Map<string, Group>();
    for (const fact of facts) {
        const key = `${fact.surface}\u0000${fact.query}\u0000${fact.page}`;
        let group = groups.get(key);
        if (!group) {
            group = { query: fact.query, page: fact.page, surface: fact.surface, clicks: 0, impressions: 0, positionSum: 0, days: new Set() };
            groups.set(key, group);
        }
        group.clicks += fact.clicks;
        group.impressions += fact.impressions;
        group.positionSum += fact.position * fact.impressions;
        group.days.add(fact.date);
    }
    return [...groups.values()];
}

function toCandidate(group: Group): Candidate {
    const position = group.impressions > 0 ? group.positionSum / group.impressions : 0;
    return {
        query: group.query,
        page: group.page,
        clicks: group.clicks,
        impressions: group.impressions,
        position,
        ctr: group.impressions > 0 ? group.clicks / group.impressions : 0,
        observedDays: group.days.size,
    };
}

function rowOf(candidate: Candidate): InvestigationRow {
    return {
        query: candidate.query,
        page: candidate.page,
        clicks: candidate.clicks,
        impressions: candidate.impressions,
        position: Math.round(candidate.position * 10) / 10,
        observedDays: candidate.observedDays,
    };
}

export function positionBands(facts: QueryPageFact[], surface: ReportingSurface): PositionBand[] {
    const byQuery = new Map<string, QueryPageFact[]>();
    for (const fact of facts) {
        if (fact.surface !== surface) continue;
        const list = byQuery.get(fact.query);
        if (list) list.push(fact);
        else byQuery.set(fact.query, [fact]);
    }
    const bands = POSITION_BANDS.map(band => ({ ...band, queries: 0, impressions: 0, clicks: 0 }));
    for (const rows of byQuery.values()) {
        const metrics = sumMetrics(rows);
        if (metrics.impressions <= 0 || metrics.position == null) continue;
        const band = bands.find(item => metrics.position != null && metrics.position >= item.min && metrics.position <= item.max);
        if (!band) continue;
        band.queries += 1;
        band.impressions += metrics.impressions;
        band.clicks += metrics.clicks;
    }
    return bands.map(({ id, label, queries, impressions, clicks }) => ({ id, label, queries, impressions, clicks }));
}

export function investigationsFor(facts: QueryPageFact[], pageFacts: QueryPageFact[], surface: ReportingSurface, brand: string): SurfaceInvestigations {
    const groups = groupQueryPages(facts.filter(fact => fact.surface === surface));
    const candidates = groups.map(toCandidate);
    const near = filterRankingCandidates(
        candidates.filter(row => row.impressions >= 100 && row.observedDays >= 3 && row.position >= 4 && row.position <= 20),
        brand,
    );
    const deeper = filterRankingCandidates(
        candidates.filter(row => row.impressions >= 100 && row.observedDays >= 3 && row.position > 20 && row.position <= 50),
        brand,
    );
    const pageGroups = new Map<string, QueryPageFact[]>();
    for (const fact of pageFacts) {
        if (fact.surface !== surface) continue;
        const list = pageGroups.get(fact.page);
        if (list) list.push(fact);
        else pageGroups.set(fact.page, [fact]);
    }
    const pageCandidates: PageCandidate[] = [];
    for (const [page, same] of pageGroups) {
        const metrics = sumMetrics(same);
        const days = new Set(same.map(row => row.date));
        if (metrics.impressions < 250 || days.size < 3 || metrics.position == null || metrics.position < 4 || metrics.position > 50) continue;
        pageCandidates.push({
            page,
            clicks: metrics.clicks,
            impressions: metrics.impressions,
            position: metrics.position,
            ctr: metrics.ctr ?? 0,
            observedDays: days.size,
        });
    }
    const pages = filterPageCandidates(pageCandidates);
    const overlapInput: OverlapCandidate[] = [];
    const byQuery = new Map<string, Group[]>();
    for (const group of groups) {
        if (group.impressions < 10 || group.days.size < 2) continue;
        const list = byQuery.get(group.query);
        if (list) list.push(group);
        else byQuery.set(group.query, [group]);
    }
    for (const [query, pagesForQuery] of byQuery) {
        if (pagesForQuery.length < 2) continue;
        const pageCandidates = pagesForQuery.map(toCandidate);
        const impressions = pageCandidates.reduce((sum, page) => sum + page.impressions, 0);
        if (impressions < 100) continue;
        const clicks = pageCandidates.reduce((sum, page) => sum + page.clicks, 0);
        overlapInput.push({
            query,
            clicks,
            impressions,
            position: pageCandidates.reduce((sum, page) => sum + page.position * page.impressions, 0) / impressions,
            ctr: impressions > 0 ? clicks / impressions : 0,
            observedDays: Math.max(...pageCandidates.map(page => page.observedDays)),
            pages: pageCandidates,
        });
    }
    const overlap = filterOverlapCandidates(overlapInput, brand);
    return {
        nearPageOne: near.map(rowOf),
        deeperVisibility: deeper.map(rowOf),
        pageVisibility: pages.map(page => ({
            page: page.page,
            clicks: page.clicks,
            impressions: page.impressions,
            position: Math.round(page.position * 10) / 10,
            observedDays: page.observedDays,
        })),
        overlappingUrls: overlap.map(row => ({
            query: row.query,
            clicks: row.clicks,
            impressions: row.impressions,
            position: Math.round(row.position * 10) / 10,
            observedDays: row.observedDays,
            pages: row.pages.map(page => ({
                page: page.page,
                clicks: page.clicks,
                impressions: page.impressions,
                position: Math.round(page.position * 10) / 10,
            })),
        })),
    };
}

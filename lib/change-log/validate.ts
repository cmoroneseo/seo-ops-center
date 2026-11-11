import { normalizeResultUrl } from '@/lib/search-reporting/result-url';

import { CHANGE_TYPES, KPIS, type ChangePage, type ChangeQuery, type ChangeType, type Kpi } from './types';
import { ptDate, ptLocalToIso } from './time';

export interface ChangeInput {
    title: string;
    changeType: string;
    beforeText: string;
    afterText: string;
    /** Pacific wall time, `YYYY-MM-DDTHH:mm`. */
    liveAtLocal: string;
    approvedByName: string;
    approvedAtLocal: string;
    backupReference: string;
    revertInstructions: string;
    kpi: string;
    compareLastYear: boolean;
    pages: { url: string; label: string; cmsPageId: string; cmsWidgetId: string }[];
    queries: string[];
}

export interface NormalizedChange {
    title: string;
    changeType: ChangeType;
    beforeText: string;
    afterText: string;
    liveAt: string;
    liveOn: string;
    approvedByName: string;
    approvedAt: string | null;
    backupReference: string;
    revertInstructions: string;
    kpi: Kpi;
    compareLastYear: boolean;
    pages: ChangePage[];
    queries: ChangeQuery[];
}

const TYPE_SET = new Set<string>(CHANGE_TYPES);
const KPI_SET = new Set<string>(KPIS);

export function normalizeQuery(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function validateChange(input: ChangeInput): string | null {
    return normalizeChange(input) ? null : invalidReason(input);
}

export function normalizeChange(input: ChangeInput): NormalizedChange | null {
    const title = input.title.trim();
    if (title.length < 1 || title.length > 160) return null;
    if (!TYPE_SET.has(input.changeType)) return null;
    if (!KPI_SET.has(input.kpi)) return null;
    if (input.beforeText.length > 4000 || input.afterText.length > 4000) return null;
    if (input.backupReference.trim().length > 500) return null;
    if (input.revertInstructions.trim().length > 2000) return null;
    const approvedByName = input.approvedByName.trim();
    if (approvedByName.length < 1 || approvedByName.length > 120) return null;
    const liveAt = ptLocalToIso(input.liveAtLocal.trim());
    if (!liveAt) return null;
    const liveOn = ptDate(liveAt);
    if (!liveOn) return null;
    const approvedAt = input.approvedAtLocal.trim() ? ptLocalToIso(input.approvedAtLocal.trim()) : null;
    if (input.approvedAtLocal.trim() && !approvedAt) return null;

    const pages: ChangePage[] = [];
    const seenPages = new Set<string>();
    for (const page of input.pages) {
        const url = page.url.trim();
        if (!url) continue;
        const urlKey = normalizeResultUrl(url);
        if (!urlKey || seenPages.has(urlKey)) continue;
        if (url.length > 2000) return null;
        seenPages.add(urlKey);
        pages.push({
            url,
            urlKey,
            label: page.label.trim().slice(0, 160),
            cmsPageId: cleanId(page.cmsPageId),
            cmsWidgetId: cleanId(page.cmsWidgetId),
        });
    }
    if (pages.length < 1 || pages.length > 8) return null;

    const queries: ChangeQuery[] = [];
    const seenQueries = new Set<string>();
    for (const raw of input.queries) {
        const query = raw.trim();
        if (!query) continue;
        const normalized = normalizeQuery(query);
        if (!normalized || normalized.length > 200 || seenQueries.has(normalized)) continue;
        seenQueries.add(normalized);
        queries.push({ query: query.slice(0, 200), normalized });
    }
    if (queries.length > 20) return null;

    return {
        title,
        changeType: input.changeType as ChangeType,
        beforeText: input.beforeText.trim(),
        afterText: input.afterText.trim(),
        liveAt,
        liveOn,
        approvedByName,
        approvedAt,
        backupReference: input.backupReference.trim(),
        revertInstructions: input.revertInstructions.trim(),
        kpi: input.kpi as Kpi,
        compareLastYear: input.compareLastYear === true,
        pages,
        queries,
    };
}

function cleanId(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, 80);
}

function invalidReason(input: ChangeInput): string {
    if (input.title.trim().length < 1) return 'Add a short title.';
    if (!TYPE_SET.has(input.changeType)) return 'Pick a change type.';
    if (!KPI_SET.has(input.kpi)) return 'Pick the metric this change should move.';
    const liveAt = ptLocalToIso(input.liveAtLocal.trim());
    if (!liveAt) return 'Enter when it went live, in Pacific time.';
    if (input.approvedByName.trim().length < 1) return 'Enter who approved it.';
    const pages = input.pages.filter(page => page.url.trim());
    if (pages.length < 1) return 'Add at least one page.';
    if (pages.some(page => !normalizeResultUrl(page.url))) return 'Page addresses need to start with http:// or https://.';
    return 'Check the form and try again.';
}

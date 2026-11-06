import { normalizeTrackerQuery } from '../search-reporting/tracker';

/** Live v1 target. Device, location, and language stay null. */
export const GSC_ALL_TARGET_LABEL = 'GSC (all locations/devices)';

/** Per-client cap for active tracked keywords. Config, not a database check. */
export const DEFAULT_TRACKED_KEYWORD_CAP = 50;

const MAX_KEYWORD_LENGTH = 500;

export type KeywordSource = 'paste' | 'gsc_promote' | 'ahrefs_import' | 'research';

export interface KeywordScope {
    organizationId: string;
    clientId: string;
}

export interface ExistingTrackedKeyword {
    id: string;
    normalizedKey: string;
    active: boolean;
}

export interface PlannedKeyword {
    keyword: string;
    normalizedKey: string;
}

export interface PlannedReactivation extends PlannedKeyword {
    id: string;
}

export interface KeywordAddPlan {
    insert: PlannedKeyword[];
    reactivate: PlannedReactivation[];
    alreadyTracked: PlannedKeyword[];
    rejectedByCap: PlannedKeyword[];
    invalid: number;
    duplicateCount: number;
    cap: number;
    activeCount: number;
    seedGscTarget: boolean;
}

/** Active keywords per client. Change this constant; it is not a database check. */
export function trackedKeywordCap(): number {
    return DEFAULT_TRACKED_KEYWORD_CAP;
}

/** One keyword per line. A single comma-separated line is also a list. */
export function splitKeywordPaste(text: string): string[] {
    const lines = text.split(/\r\n|\n|\r/).map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length === 1 && lines[0].includes(',')) {
        return lines[0].split(',').map(part => part.trim()).filter(part => part.length > 0);
    }
    return lines;
}

export function planKeywordAdds(input: {
    entries: string[];
    existing: ExistingTrackedKeyword[];
    hasLiveGscTarget: boolean;
    cap?: number;
}): KeywordAddPlan {
    const cap = input.cap ?? trackedKeywordCap();
    const activeCount = input.existing.filter(row => row.active).length;
    const activeKeys = new Set(input.existing.filter(row => row.active).map(row => row.normalizedKey));
    const inactiveByKey = new Map<string, string>();
    for (const row of input.existing) {
        if (row.active || activeKeys.has(row.normalizedKey) || inactiveByKey.has(row.normalizedKey)) continue;
        inactiveByKey.set(row.normalizedKey, row.id);
    }

    const seen = new Set<string>();
    const candidates: PlannedKeyword[] = [];
    let invalid = 0;
    let duplicateCount = 0;
    for (const entry of input.entries) {
        const keyword = entry.trim().replace(/\s+/g, ' ');
        const normalizedKey = normalizeTrackerQuery(keyword);
        if (!normalizedKey || keyword.length > MAX_KEYWORD_LENGTH || normalizedKey.length > MAX_KEYWORD_LENGTH) {
            invalid += 1;
            continue;
        }
        if (seen.has(normalizedKey)) {
            duplicateCount += 1;
            continue;
        }
        seen.add(normalizedKey);
        candidates.push({ keyword, normalizedKey });
    }

    const insert: PlannedKeyword[] = [];
    const reactivate: PlannedReactivation[] = [];
    const alreadyTracked: PlannedKeyword[] = [];
    const rejectedByCap: PlannedKeyword[] = [];
    let room = Math.max(0, cap - activeCount);
    for (const candidate of candidates) {
        if (activeKeys.has(candidate.normalizedKey)) {
            alreadyTracked.push(candidate);
            continue;
        }
        if (room <= 0) {
            rejectedByCap.push(candidate);
            continue;
        }
        const inactiveId = inactiveByKey.get(candidate.normalizedKey);
        if (inactiveId) reactivate.push({ ...candidate, id: inactiveId });
        else insert.push(candidate);
        room -= 1;
    }

    return {
        insert,
        reactivate,
        alreadyTracked,
        rejectedByCap,
        invalid,
        duplicateCount,
        cap,
        activeCount,
        seedGscTarget: !input.hasLiveGscTarget && insert.length > 0,
    };
}

export function keywordsChangedNote(keywords: string[]): string {
    const count = keywords.length;
    const noun = count === 1 ? 'keyword' : 'keywords';
    const head = `Tracked ${count} ${noun}: `;
    let body = `${head}${keywords.join(', ')}.`;
    if (body.length <= 8000) return body;
    const shortList = keywords.slice(0, 12).join(', ');
    body = `${head}${shortList}.`;
    if (body.length <= 8000) return body;
    return body.slice(0, 8000);
}

export function describeKeywordAdd(plan: KeywordAddPlan): string {
    const added = plan.insert.length + plan.reactivate.length;
    if (added === 0 && plan.alreadyTracked.length === 0 && plan.rejectedByCap.length === 0) {
        return 'Enter at least one keyword.';
    }
    const parts: string[] = [];
    if (added > 0) parts.push(`Tracked ${added} ${added === 1 ? 'keyword' : 'keywords'}.`);
    if (plan.alreadyTracked.length > 0) {
        const count = plan.alreadyTracked.length;
        parts.push(`${count} ${count === 1 ? 'was' : 'were'} already tracked.`);
    }
    if (plan.rejectedByCap.length > 0) {
        const count = plan.rejectedByCap.length;
        parts.push(`${count} not added. This client is at the ${plan.cap} keyword cap.`);
    }
    if (plan.invalid > 0) {
        parts.push(`${plan.invalid} ${plan.invalid === 1 ? 'line was' : 'lines were'} skipped.`);
    }
    return parts.join(' ');
}

export function gscTargetInsert(scope: KeywordScope) {
    return {
        organization_id: scope.organizationId,
        client_id: scope.clientId,
        label: GSC_ALL_TARGET_LABEL,
        engine: 'gsc' as const,
    };
}

export function trackedKeywordInsert(
    scope: KeywordScope,
    targetId: string,
    keyword: PlannedKeyword,
    source: KeywordSource,
) {
    return {
        organization_id: scope.organizationId,
        client_id: scope.clientId,
        target_id: targetId,
        keyword: keyword.keyword,
        source,
    };
}

export function keywordsChangedNoteInsert(
    scope: KeywordScope,
    targetId: string | null,
    body: string,
    createdBy: string | null,
) {
    return {
        organization_id: scope.organizationId,
        client_id: scope.clientId,
        target_id: targetId,
        kind: 'keywords_changed' as const,
        body,
        created_by: createdBy,
    };
}

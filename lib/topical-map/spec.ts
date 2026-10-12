import type {
    MapOutgoingLink,
    MapScopeExclusion,
    PageType,
    RecordSource,
    SpecStatus,
    TopicalMapRecord,
} from '../types';

/** Shown wherever a spec value is missing. Never substitute 0 or a blank. */
export const EMPTY_SPEC = '\u2014';

export const PAGE_TYPES: PageType[] = [
    'pillar', 'service', 'landing', 'product', 'collection', 'city',
    'blog_post', 'guide', 'faq', 'resource_center', 'knowledge_base',
    'homepage', 'comparison', 'case_study', 'other',
];

export const RECORD_SOURCES: RecordSource[] = ['generated', 'manual', 'crawl', 'gsc'];
export const SPEC_STATUSES: SpecStatus[] = ['draft', 'ready'];

export const SOURCE_TITLE: Record<RecordSource, string> = {
    manual: 'Added by hand',
    generated: 'Generated with the map',
    crawl: 'Matched from a crawl',
    gsc: 'Suggested from Search Console',
};

const WORD_LIMIT = 60;
const ANSWER_CHARS = 2000;
const ANGLE_CHARS = 4000;
const TITLE_CHARS = 300;
const QUERY_CHARS = 300;
const LIST_LIMIT = 30;

export function countWords(value: string): number {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
}

export function displayText(value: string | null | undefined): string {
    const trimmed = value?.trim() ?? '';
    return trimmed ? trimmed : EMPTY_SPEC;
}

/** 0 and missing counts are empty. Keyword difficulty is not this helper. */
export function displayCount(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value) || value <= 0) return EMPTY_SPEC;
    return new Intl.NumberFormat('en-US').format(value);
}

export function displayWordRange(min?: number | null, max?: number | null): string {
    const lo = min != null && min > 0 ? min : null;
    const hi = max != null && max > 0 ? max : null;
    if (lo == null && hi == null) return EMPTY_SPEC;
    const format = (value: number) => new Intl.NumberFormat('en-US').format(value);
    if (lo != null && hi != null) return `${format(lo)}\u2013${format(hi)}`;
    if (lo != null) return `${format(lo)}+`;
    return `up to ${format(hi as number)}`;
}

export function displayDate(value: string | null | undefined): string {
    const parsed = parseScheduledFor(value);
    if (!parsed.ok || !parsed.value) return EMPTY_SPEC;
    const [year, month, day] = parsed.value.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function isRecordSource(value: unknown): value is RecordSource {
    return RECORD_SOURCES.includes(value as RecordSource);
}

export function isSpecStatus(value: unknown): value is SpecStatus {
    return SPEC_STATUSES.includes(value as SpecStatus);
}

export function isPageType(value: unknown): value is PageType {
    return PAGE_TYPES.includes(value as PageType);
}

export function cleanOptionalText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}

export function scheduledForValue(value: unknown): string | undefined {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    if (typeof value !== 'string') return undefined;
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    if (!match) return undefined;
    const parsed = parseScheduledFor(match[1]);
    return parsed.ok ? parsed.value ?? undefined : undefined;
}

export function normalizeScopeExclusions(value: unknown): MapScopeExclusion[] {
    if (!Array.isArray(value)) return [];
    const items: MapScopeExclusion[] = [];
    for (const item of value) {
        if (typeof item === 'string') {
            const url = item.trim();
            if (url) items.push({ url });
            continue;
        }
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const url = String(row.url ?? row.path ?? '').trim();
        const reason = String(row.reason ?? row.note ?? '').trim();
        if (!url && !reason) continue;
        items.push(reason ? { url, reason } : { url });
    }
    return items;
}

export function normalizeOutgoingLinks(value: unknown): MapOutgoingLink[] {
    if (!Array.isArray(value)) return [];
    const items: MapOutgoingLink[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const anchorText = String(row.anchorText ?? row.anchor_text ?? '').trim();
        const destinationUrl = String(row.destinationUrl ?? row.destination_url ?? '').trim();
        const destinationTitle = String(row.destinationTitle ?? row.destination_title ?? '').trim();
        const destination = destinationUrl || destinationTitle;
        if (!anchorText && !destination) continue;
        const destinationRecordId = row.destinationRecordId ?? row.destination_record_id;
        items.push({
            anchorText,
            destinationUrl: destination,
            ...(typeof destinationRecordId === 'string' && destinationRecordId
                ? { destinationRecordId }
                : {}),
        });
    }
    return items;
}

export interface SpecFieldPatch {
    targetQuery?: string;
    wordCountMin?: number | null;
    wordCountMax?: number | null;
    answerFirst60?: string | null;
    uniqueAngle?: string | null;
    scheduledFor?: string | null;
    specStatus?: SpecStatus | null;
    scopeExclusions?: MapScopeExclusion[];
    outgoingLinks?: MapOutgoingLink[];
}

export interface ManualRecordDraft {
    title: string;
    targetQuery: string;
    pageType: PageType;
    wordCountMin: number | null;
    wordCountMax: number | null;
    answerFirst60: string | null;
    uniqueAngle: string | null;
    scheduledFor: string | null;
    specStatus: SpecStatus | null;
    scopeExclusions: MapScopeExclusion[];
    outgoingLinks: MapOutgoingLink[];
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function asRecord(input: unknown): Record<string, unknown> | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    return input as Record<string, unknown>;
}

function parseCount(value: unknown, label: string): Parsed<number | null> {
    if (value == null || value === '') return { ok: true, value: null };
    const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 100000) {
        return { ok: false, error: `${label} must be a whole number up to 100000.` };
    }
    return { ok: true, value: numeric === 0 ? null : numeric };
}

export function parseScheduledFor(value: unknown): Parsed<string | null> {
    if (value == null || value === '') return { ok: true, value: null };
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return { ok: false, error: 'Scheduled date must be YYYY-MM-DD.' };
    }
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return { ok: false, error: 'Scheduled date is not a real calendar date.' };
    }
    return { ok: true, value: value };
}

function parseText(value: unknown, label: string, max: number, words?: number): Parsed<string | null> {
    if (value == null || value === '') return { ok: true, value: null };
    if (typeof value !== 'string') return { ok: false, error: `${label} must be text.` };
    const trimmed = value.trim();
    if (!trimmed) return { ok: true, value: null };
    if (trimmed.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer.` };
    if (words != null && countWords(trimmed) > words) {
        return { ok: false, error: `${label} must be ${words} words or fewer (${countWords(trimmed)} words).` };
    }
    return { ok: true, value: trimmed };
}

function rejectScript(value: string): boolean {
    return /^\s*javascript:/i.test(value);
}

function parseExclusions(value: unknown): Parsed<MapScopeExclusion[]> {
    if (value == null) return { ok: true, value: [] };
    const items = normalizeScopeExclusions(value);
    if (!Array.isArray(value)) return { ok: false, error: 'Stays out of must be a list.' };
    if (value.length > LIST_LIMIT) return { ok: false, error: 'Stays out of can include at most 30 items.' };
    const cleaned: MapScopeExclusion[] = [];
    for (const item of items) {
        if (!item.url.trim()) return { ok: false, error: 'Stays out of needs a page or topic.' };
        if (item.url.length > 500 || rejectScript(item.url)) {
            return { ok: false, error: 'Stays out of has an entry that cannot be saved.' };
        }
        if (item.reason && item.reason.length > 300) {
            return { ok: false, error: 'A stays-out reason must be 300 characters or fewer.' };
        }
        cleaned.push(item.reason ? { url: item.url, reason: item.reason } : { url: item.url });
    }
    return { ok: true, value: cleaned };
}

function parseLinks(value: unknown): Parsed<MapOutgoingLink[]> {
    if (value == null) return { ok: true, value: [] };
    if (!Array.isArray(value)) return { ok: false, error: 'Planned links must be a list.' };
    if (value.length > LIST_LIMIT) return { ok: false, error: 'Planned links can include at most 30 items.' };
    const cleaned: MapOutgoingLink[] = [];
    for (const item of normalizeOutgoingLinks(value)) {
        if (!item.anchorText || !item.destinationUrl) {
            return { ok: false, error: 'Each planned link needs an anchor and a destination.' };
        }
        if (item.anchorText.length > 200 || item.destinationUrl.length > 500 || rejectScript(item.destinationUrl)) {
            return { ok: false, error: 'A planned link cannot be saved.' };
        }
        cleaned.push({
            anchorText: item.anchorText,
            destinationUrl: item.destinationUrl,
            ...(item.destinationRecordId ? { destinationRecordId: item.destinationRecordId } : {}),
        });
    }
    return { ok: true, value: cleaned };
}

function parseWordRange(source: Record<string, unknown>, requireBoth = false): Parsed<{ min: number | null; max: number | null }> {
    const min = parseCount(source.wordCountMin, 'Word range minimum');
    if (!min.ok) return min;
    const max = parseCount(source.wordCountMax, 'Word range maximum');
    if (!max.ok) return max;
    if (requireBoth && min.value == null && max.value == null) return { ok: true, value: { min: null, max: null } };
    if (min.value != null && max.value != null && min.value > max.value) {
        return { ok: false, error: 'Word range minimum cannot be above the maximum.' };
    }
    return { ok: true, value: { min: min.value, max: max.value } };
}

export function parseSpecPatch(input: unknown): { ok: true; patch: SpecFieldPatch } | { ok: false; error: string } {
    const source = asRecord(input);
    if (!source) return { ok: false, error: 'Nothing to save.' };
    const patch: SpecFieldPatch = {};
    let seen = false;

    if ('targetQuery' in source) {
        seen = true;
        if (typeof source.targetQuery !== 'string') return { ok: false, error: 'Target query must be text.' };
        const query = source.targetQuery.trim();
        if (query.length > QUERY_CHARS) return { ok: false, error: `Target query must be ${QUERY_CHARS} characters or fewer.` };
        patch.targetQuery = query;
    }
    if ('wordCountMin' in source || 'wordCountMax' in source) {
        seen = true;
        const range = parseWordRange(source);
        if (!range.ok) return range;
        if ('wordCountMin' in source) patch.wordCountMin = range.value.min;
        if ('wordCountMax' in source) patch.wordCountMax = range.value.max;
    }
    if ('answerFirst60' in source) {
        seen = true;
        const answer = parseText(source.answerFirst60, 'Answer in the first 60 words', ANSWER_CHARS, WORD_LIMIT);
        if (!answer.ok) return answer;
        patch.answerFirst60 = answer.value;
    }
    if ('uniqueAngle' in source) {
        seen = true;
        const angle = parseText(source.uniqueAngle, 'Unique angle', ANGLE_CHARS);
        if (!angle.ok) return angle;
        patch.uniqueAngle = angle.value;
    }
    if ('scheduledFor' in source) {
        seen = true;
        const date = parseScheduledFor(source.scheduledFor);
        if (!date.ok) return date;
        patch.scheduledFor = date.value;
    }
    if ('specStatus' in source) {
        seen = true;
        if (source.specStatus == null || source.specStatus === '') patch.specStatus = null;
        else if (isSpecStatus(source.specStatus)) patch.specStatus = source.specStatus;
        else return { ok: false, error: 'Spec status must be draft or ready.' };
    }
    if ('scopeExclusions' in source) {
        seen = true;
        const exclusions = parseExclusions(source.scopeExclusions);
        if (!exclusions.ok) return exclusions;
        patch.scopeExclusions = exclusions.value;
    }
    if ('outgoingLinks' in source) {
        seen = true;
        const links = parseLinks(source.outgoingLinks);
        if (!links.ok) return links;
        patch.outgoingLinks = links.value;
    }

    if (!seen) return { ok: false, error: 'Nothing to save.' };
    return { ok: true, patch };
}

export function specColumnUpdates(patch: SpecFieldPatch): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    if (patch.targetQuery !== undefined) row.target_query = patch.targetQuery;
    if (patch.wordCountMin !== undefined) row.word_count_min = patch.wordCountMin ?? 0;
    if (patch.wordCountMax !== undefined) row.word_count_max = patch.wordCountMax ?? 0;
    if (patch.answerFirst60 !== undefined) row.answer_first_60 = patch.answerFirst60;
    if (patch.uniqueAngle !== undefined) row.unique_angle = patch.uniqueAngle;
    if (patch.scheduledFor !== undefined) row.scheduled_for = patch.scheduledFor;
    if (patch.specStatus !== undefined) row.spec_status = patch.specStatus;
    if (patch.scopeExclusions !== undefined) row.scope_exclusions = patch.scopeExclusions;
    if (patch.outgoingLinks !== undefined) row.outgoing_links = patch.outgoingLinks;
    return row;
}

export function parseExclusionLines(text: string): MapScopeExclusion[] {
    return text.split('\n').flatMap(line => {
        const trimmed = line.trim();
        if (!trimmed) return [];
        const parts = trimmed.split(/\s+\|\s+/);
        const url = parts[0]?.trim() ?? '';
        const reason = parts.slice(1).join(' | ').trim();
        if (!url) return [];
        return [reason ? { url, reason } : { url }];
    });
}

export function parseLinkLines(text: string): { ok: true; links: MapOutgoingLink[] } | { ok: false; error: string } {
    const links: MapOutgoingLink[] = [];
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const parts = line.split(/\s+\|\s+/);
        if (parts.length < 2 || !parts[0].trim() || !parts[1].trim()) {
            return { ok: false, error: 'Each planned link needs an anchor and a destination, separated by |.' };
        }
        links.push({ anchorText: parts[0].trim(), destinationUrl: parts.slice(1).join(' | ').trim() });
    }
    return { ok: true, links };
}

export function parseManualRecord(input: unknown): { ok: true; draft: ManualRecordDraft } | { ok: false; error: string } {
    const source = asRecord(input);
    if (!source) return { ok: false, error: 'Add a title.' };
    if (typeof source.title !== 'string' || !source.title.trim()) return { ok: false, error: 'Add a title.' };
    const title = source.title.trim();
    if (title.length > TITLE_CHARS) return { ok: false, error: `Title must be ${TITLE_CHARS} characters or fewer.` };

    const query = typeof source.targetQuery === 'string' ? source.targetQuery.trim() : '';
    if (query.length > QUERY_CHARS) return { ok: false, error: `Target query must be ${QUERY_CHARS} characters or fewer.` };

    const pageType = source.pageType == null || source.pageType === '' ? 'other' : source.pageType;
    if (!isPageType(pageType)) return { ok: false, error: 'Choose a page type.' };

    const range = parseWordRange(source);
    if (!range.ok) return range;
    const answer = parseText(source.answerFirst60, 'Answer in the first 60 words', ANSWER_CHARS, WORD_LIMIT);
    if (!answer.ok) return answer;
    const angle = parseText(source.uniqueAngle, 'Unique angle', ANGLE_CHARS);
    if (!angle.ok) return angle;
    const scheduled = parseScheduledFor(source.scheduledFor);
    if (!scheduled.ok) return scheduled;
    const status = source.specStatus == null || source.specStatus === ''
        ? { ok: true as const, value: null }
        : isSpecStatus(source.specStatus)
            ? { ok: true as const, value: source.specStatus }
            : { ok: false as const, error: 'Spec status must be draft or ready.' };
    if (!status.ok) return status;
    const exclusions = parseExclusions(source.scopeExclusions ?? []);
    if (!exclusions.ok) return exclusions;
    const links = parseLinks(source.outgoingLinks ?? []);
    if (!links.ok) return links;

    return {
        ok: true,
        draft: {
            title,
            targetQuery: query,
            pageType,
            wordCountMin: range.value.min,
            wordCountMax: range.value.max,
            answerFirst60: answer.value,
            uniqueAngle: angle.value,
            scheduledFor: scheduled.value,
            specStatus: status.value,
            scopeExclusions: exclusions.value,
            outgoingLinks: links.value,
        },
    };
}

export function manualInsertRow(
    draft: ManualRecordDraft,
    context: { siloId: string; mapId: string; organizationId: string; sortOrder: number },
): Record<string, unknown> {
    return {
        silo_id: context.siloId,
        map_id: context.mapId,
        organization_id: context.organizationId,
        page_type: draft.pageType,
        action: 'create',
        title: draft.title,
        target_query: draft.targetQuery,
        word_count_min: draft.wordCountMin ?? 0,
        word_count_max: draft.wordCountMax ?? 0,
        build_phase: 1,
        scope_exclusions: draft.scopeExclusions,
        outgoing_links: draft.outgoingLinks,
        status: 'pending',
        source: 'manual',
        answer_first_60: draft.answerFirst60,
        unique_angle: draft.uniqueAngle,
        scheduled_for: draft.scheduledFor,
        spec_status: draft.specStatus,
        sort_order: context.sortOrder,
    };
}

/** Task body written when an AM approves a record. Spec lines are omitted when empty. */
export function approvalTaskDescription(record: TopicalMapRecord): string {
    const wordCount = taskWordCount(record.wordCountMin, record.wordCountMax);
    return [
        `**Target Query:** ${record.targetQuery}`,
        `**Page Type:** ${record.pageType}`,
        record.contentCategory ? `**Category:** ${record.contentCategory}` : '',
        wordCount ? `**Word Count:** ${wordCount}` : '',
        `**Build Phase:** ${record.buildPhase}`,
        record.refreshIntervalDays ? `**Refresh:** every ${record.refreshIntervalDays} days` : '',
        record.scopeExclusions.length > 0
            ? `**Stays out of:** ${record.scopeExclusions.map(item => item.url).join(', ')}`
            : '',
        record.outgoingLinks.length > 0
            ? `**Links out:** ${record.outgoingLinks.map(link => `${link.anchorText} → ${link.destinationUrl}`).join(', ')}`
            : '',
        record.answerFirst60?.trim() ? `**Answer in the first 60 words:** ${record.answerFirst60.trim()}` : '',
        record.uniqueAngle?.trim() ? `**Unique angle:** ${record.uniqueAngle.trim()}` : '',
        record.scheduledFor ? `**Scheduled for:** ${record.scheduledFor}` : '',
    ].filter(Boolean).join('\n');
}

function taskWordCount(min: number, max: number): string {
    const lo = min > 0 ? min : null;
    const hi = max > 0 ? max : null;
    if (lo == null && hi == null) return '';
    if (lo != null && hi != null) return `${lo}\u2013${hi}`;
    if (lo != null) return `${lo}+`;
    return `up to ${hi}`;
}

export function approveUpdate(taskId: string): { status: 'approved'; taskId: string } {
    return { status: 'approved', taskId };
}

export function declineUpdate(): { status: 'declined' } {
    return { status: 'declined' };
}

export function cycleTab(currentIndex: number, count: number, shift: boolean): number {
    if (count <= 0) return 0;
    if (currentIndex < 0) return shift ? count - 1 : 0;
    if (shift) return currentIndex === 0 ? count - 1 : currentIndex - 1;
    return currentIndex === count - 1 ? 0 : currentIndex + 1;
}

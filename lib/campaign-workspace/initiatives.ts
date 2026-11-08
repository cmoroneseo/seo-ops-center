/**
 * Campaign initiatives: the work object for Roadmap, key initiatives,
 * the next milestone, and completed delivery.
 *
 * Dates, evidence, and checklist rows are stored. A missing date is not a bar.
 * Completed & Verified without an evidence URL and a verification date is not
 * a verified win. Evidence older than EVIDENCE_FRESH_DAYS is stale.
 * Phase, category, and target month are the client-facing roadmap story.
 * Empty, missing, and unknown values are not set. Target month does not
 * move the schedule. They are not a progress percent and not a traffic result.
 * Nothing here is a traffic result, and nothing reads the strategy plan.
 */

export const EVIDENCE_FRESH_DAYS = 60;

export const INITIATIVE_STATES = [
    'planned',
    'in_progress',
    'awaiting_approval',
    'blocked',
    'on_hold',
    'completed_verified',
] as const;

export const CONTENT_STATES = ['draft', 'review', 'approved', 'published'] as const;

/** Stored slugs. Display copy lives in PHASE_LABEL. Empty means not set. */
export const INITIATIVE_PHASES = ['foundation', 'growth', 'scale'] as const;

export const PHASE_LABEL: Record<(typeof INITIATIVE_PHASES)[number], string> = {
    foundation: 'Phase 1 · Foundation',
    growth: 'Phase 2 · Growth',
    scale: 'Phase 3 · Scale',
};

/**
 * Stored slugs from the template Lists tab, Roadmap Category D2:D7.
 * Display copy lives in CATEGORY_LABEL. Empty means not set.
 */
export const INITIATIVE_CATEGORIES = [
    'technical',
    'on_page',
    'content',
    'local_seo',
    'link_building',
    'analytics_reporting',
] as const;

export const CATEGORY_LABEL: Record<(typeof INITIATIVE_CATEGORIES)[number], string> = {
    technical: 'Technical',
    on_page: 'On-Page',
    content: 'Content',
    local_seo: 'Local SEO',
    link_building: 'Link Building',
    analytics_reporting: 'Analytics & Reporting',
};

/** Engagement-relative integers. Empty means not set. Not a calendar month. */
export const INITIATIVE_TARGET_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export const PHASE_UNSET_LABEL = 'No phase';
export const UNSET_MARK = '—';

export type InitiativeState = (typeof INITIATIVE_STATES)[number];
export type ContentState = (typeof CONTENT_STATES)[number];
export type InitiativePhase = (typeof INITIATIVE_PHASES)[number];
export type InitiativeCategory = (typeof INITIATIVE_CATEGORIES)[number];
export type InitiativeTargetMonth = (typeof INITIATIVE_TARGET_MONTHS)[number];
export type InitiativePriority = 1 | 2 | 3 | 4;
export type InitiativeTone = 'neutral' | 'in-progress' | 'approval' | 'blocked' | 'fresh' | 'stale' | 'incomplete';

export interface InitiativeItem {
    id: string;
    title: string;
    contentState: ContentState;
    draftUrl: string | null;
    liveUrl: string | null;
    publishedOn: string | null;
    position: number;
}

export interface CampaignInitiative {
    id: string;
    organizationId: string;
    clientId: string;
    title: string;
    purpose: string | null;
    ownerName: string | null;
    phase: InitiativePhase | null;
    category: InitiativeCategory | null;
    targetMonth: InitiativeTargetMonth | null;
    priority: InitiativePriority;
    state: InitiativeState;
    startsOn: string | null;
    endsOn: string | null;
    pageUrl: string | null;
    successMetricLabel: string | null;
    evidenceUrl: string | null;
    verifiedOn: string | null;
    items: InitiativeItem[];
}

export interface InitiativeDraftItem {
    id?: string | null;
    title: string;
    contentState: string;
    draftUrl: string;
    liveUrl: string;
    publishedOn: string;
}

export interface InitiativeDraft {
    title: string;
    purpose: string;
    ownerName: string;
    phase: string;
    category: string;
    targetMonth: string;
    priority: string;
    state: string;
    startsOn: string;
    endsOn: string;
    pageUrl: string;
    successMetricLabel: string;
    evidenceUrl: string;
    verifiedOn: string;
    items: InitiativeDraftItem[];
}

export interface InitiativeWriteItem {
    id: string | null;
    title: string;
    contentState: ContentState;
    draftUrl: string | null;
    liveUrl: string | null;
    publishedOn: string | null;
    position: number;
}

export interface InitiativeWrite {
    title: string;
    purpose: string | null;
    ownerName: string | null;
    phase: InitiativePhase | null;
    category: InitiativeCategory | null;
    targetMonth: InitiativeTargetMonth | null;
    priority: InitiativePriority;
    state: InitiativeState;
    startsOn: string | null;
    endsOn: string | null;
    pageUrl: string | null;
    successMetricLabel: string | null;
    evidenceUrl: string | null;
    verifiedOn: string | null;
    items: InitiativeWriteItem[];
}

export interface NextMilestone {
    initiativeId: string;
    title: string;
    date: string;
    dateLabel: string;
    shortDate: string;
    ownerLabel: string;
    items: { id: string; title: string; stateLabel: string }[];
}

export interface TimelineBar {
    kind: 'span' | 'point';
    start: number;
    end: number;
}

export interface TimelineRow {
    id: string;
    title: string;
    purpose: string | null;
    phase: InitiativePhase | null;
    category: InitiativeCategory | null;
    targetMonth: InitiativeTargetMonth | null;
    priorityLabel: string;
    stateLabel: string;
    tone: InitiativeTone;
    datesLabel: string;
    bar: TimelineBar | null;
}

export interface RoadmapPhaseGroup {
    phase: InitiativePhase | null;
    label: string;
    rows: TimelineRow[];
}

export interface TimelineModel {
    months: { key: string; label: string }[];
    todayFraction: number | null;
    todayLabel: string | null;
    rows: TimelineRow[];
}

export interface CompletedDelivery {
    id: string;
    title: string;
    url: string | null;
    dateLabel: string | null;
    dateKind: 'published' | 'verified' | null;
    verification: 'fresh' | 'stale';
}

export interface StatePresentation {
    label: string;
    tone: InitiativeTone;
}

type DraftOk = { ok: true; value: InitiativeWrite };
type DraftFail = { ok: false; error: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ITEM_CAP = 20;

const STATE_LABEL: Record<InitiativeState, string> = {
    planned: 'Planned',
    in_progress: 'In Progress',
    awaiting_approval: 'Awaiting Approval',
    blocked: 'Blocked',
    on_hold: 'On Hold',
    completed_verified: 'Completed & Verified',
};

export const CONTENT_LABEL: Record<ContentState, string> = {
    draft: 'Draft',
    review: 'Review',
    approved: 'Approved',
    published: 'Published',
};

export function formatInitiativeDay(iso: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return iso;
    const month = MONTHS[Number(match[2]) - 1] ?? iso;
    return `${month} ${Number(match[3])}, ${match[1]}`;
}

export function formatInitiativeShort(iso: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return iso;
    const month = MONTHS[Number(match[2]) - 1] ?? iso;
    return `${month} ${Number(match[3])}`;
}

export function isoDayNumber(iso: string): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return Number.NaN;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000;
}

export function addIsoDays(iso: string, days: number): string {
    const day = isoDayNumber(iso);
    if (!Number.isFinite(day)) throw new Error('Invalid date');
    const date = new Date((day + days) * 86400000);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dayOfMonth = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${dayOfMonth}`;
}

export function safeHttpUrl(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url.href;
    } catch {
        return null;
    }
}

/** Fresh through the verification date plus EVIDENCE_FRESH_DAYS. An unreadable date is not fresh. */
export function evidenceFreshness(verifiedOn: string, today: string): 'fresh' | 'stale' {
    if (!ISO.test(verifiedOn) || !ISO.test(today)) return 'stale';
    return today <= addIsoDays(verifiedOn, EVIDENCE_FRESH_DAYS) ? 'fresh' : 'stale';
}

export function verificationTone(
    initiative: Pick<CampaignInitiative, 'state' | 'evidenceUrl' | 'verifiedOn'>,
    today: string,
): 'fresh' | 'stale' | 'incomplete' | 'none' {
    if (initiative.state !== 'completed_verified') return 'none';
    const evidence = safeHttpUrl(initiative.evidenceUrl);
    if (!evidence || !initiative.verifiedOn || !ISO.test(initiative.verifiedOn)) return 'incomplete';
    return evidenceFreshness(initiative.verifiedOn, today);
}

export function statePresentation(
    initiative: Pick<CampaignInitiative, 'state' | 'evidenceUrl' | 'verifiedOn'>,
    today: string,
): StatePresentation {
    const verification = verificationTone(initiative, today);
    if (verification === 'stale') {
        return { label: 'Completed & Verified · Evidence stale — re-verify', tone: 'stale' };
    }
    if (verification === 'incomplete') {
        return { label: 'Verification incomplete', tone: 'incomplete' };
    }
    if (verification === 'fresh') {
        return { label: STATE_LABEL.completed_verified, tone: 'fresh' };
    }
    switch (initiative.state) {
        case 'in_progress':
            return { label: STATE_LABEL.in_progress, tone: 'in-progress' };
        case 'awaiting_approval':
            return { label: STATE_LABEL.awaiting_approval, tone: 'approval' };
        case 'blocked':
            return { label: STATE_LABEL.blocked, tone: 'blocked' };
        case 'on_hold':
            return { label: STATE_LABEL.on_hold, tone: 'neutral' };
        case 'planned':
            return { label: STATE_LABEL.planned, tone: 'neutral' };
        default:
            return { label: STATE_LABEL.planned, tone: 'neutral' };
    }
}

function scheduleKey(initiative: CampaignInitiative): string {
    return initiative.startsOn ?? initiative.endsOn ?? '9999-99-99';
}

export function orderedInitiatives(initiatives: readonly CampaignInitiative[]): CampaignInitiative[] {
    return [...initiatives].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        const schedule = scheduleKey(a).localeCompare(scheduleKey(b));
        if (schedule !== 0) return schedule;
        return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
}

function upcomingDate(initiative: CampaignInitiative, today: string): string | null {
    if (!ISO.test(today) || initiative.state === 'completed_verified') return null;
    if (initiative.endsOn && ISO.test(initiative.endsOn) && initiative.endsOn >= today) return initiative.endsOn;
    if (!initiative.endsOn && initiative.startsOn && ISO.test(initiative.startsOn) && initiative.startsOn >= today) {
        return initiative.startsOn;
    }
    return null;
}

export function nextMilestone(initiatives: readonly CampaignInitiative[], today: string): NextMilestone | null {
    let best: CampaignInitiative | null = null;
    let bestDate = '';
    for (const initiative of initiatives) {
        const date = upcomingDate(initiative, today);
        if (!date) continue;
        const closer = date < bestDate;
        const tie = date === bestDate && best != null && (
            initiative.priority < best.priority
            || (initiative.priority === best.priority && initiative.title.localeCompare(best.title) < 0)
        );
        if (!best || closer || tie) {
            best = initiative;
            bestDate = date;
        }
    }
    if (!best) return null;
    const owner = best.ownerName?.trim() ?? '';
    return {
        initiativeId: best.id,
        title: best.title,
        date: bestDate,
        dateLabel: formatInitiativeDay(bestDate),
        shortDate: formatInitiativeShort(bestDate),
        ownerLabel: owner || 'Not set yet',
        items: [...best.items]
            .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
            .map(item => ({
                id: item.id,
                title: item.title,
                stateLabel: CONTENT_LABEL[item.contentState],
            })),
    };
}

function monthKey(iso: string): string {
    return iso.slice(0, 7);
}

function monthStart(key: string): string {
    return `${key}-01`;
}

function monthEnd(key: string): string {
    const [year, month] = key.split('-').map(Number);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${key}-${String(last).padStart(2, '0')}`;
}

function addMonth(key: string): string {
    const [year, month] = key.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + 1, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthsBetween(startKey: string, endKey: string): string[] {
    const keys: string[] = [];
    let cursor = startKey;
    while (cursor <= endKey && keys.length < 36) {
        keys.push(cursor);
        cursor = addMonth(cursor);
    }
    return keys;
}

function fraction(day: string, start: string, end: string): number {
    const span = isoDayNumber(end) - isoDayNumber(start);
    if (span <= 0) return 0;
    const value = (isoDayNumber(day) - isoDayNumber(start)) / span;
    return Math.min(1, Math.max(0, value));
}

function closedMember<T extends string>(value: unknown, allowed: readonly T[]): T | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return (allowed as readonly string[]).includes(trimmed) ? trimmed as T : null;
}

/** Missing, blank, or unknown reads as not set. Never as zero. */
export function readInitiativePhase(value: unknown): InitiativePhase | null {
    return closedMember(value, INITIATIVE_PHASES);
}

/** Missing, blank, or unknown reads as not set. Never as zero. */
export function readInitiativeCategory(value: unknown): InitiativeCategory | null {
    return closedMember(value, INITIATIVE_CATEGORIES);
}

/** Missing, blank, or unknown reads as not set. Never as zero or a calendar month. */
export function readInitiativeTargetMonth(value: unknown): InitiativeTargetMonth | null {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12) {
        return value as InitiativeTargetMonth;
    }
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!/^([1-9]|1[0-2])$/.test(trimmed)) return null;
    return Number(trimmed) as InitiativeTargetMonth;
}

export function phaseGroupLabel(phase: InitiativePhase, count: number): string {
    const noun = count === 1 ? 'initiative' : 'initiatives';
    return `${PHASE_LABEL[phase]} — ${count} ${noun}`;
}

export function readInitiativeStory(row: {
    phase?: unknown;
    category?: unknown;
    target_month?: unknown;
}): { phase: InitiativePhase | null; category: InitiativeCategory | null; targetMonth: InitiativeTargetMonth | null } {
    return {
        phase: readInitiativePhase(row.phase),
        category: readInitiativeCategory(row.category),
        targetMonth: readInitiativeTargetMonth(row.target_month),
    };
}

function datesLabel(initiative: CampaignInitiative): string {
    if (initiative.startsOn && initiative.endsOn) {
        if (initiative.startsOn === initiative.endsOn) return formatInitiativeDay(initiative.startsOn);
        return `${formatInitiativeShort(initiative.startsOn)} – ${formatInitiativeDay(initiative.endsOn)}`;
    }
    if (initiative.startsOn) return `Starts ${formatInitiativeDay(initiative.startsOn)}`;
    if (initiative.endsOn) return `Ends ${formatInitiativeDay(initiative.endsOn)}`;
    return 'Dates not set';
}

function presentTimelineRow(row: CampaignInitiative, today: string, bar: TimelineBar | null): TimelineRow {
    const presentation = statePresentation(row, today);
    return {
        id: row.id,
        title: row.title,
        purpose: row.purpose,
        phase: row.phase,
        category: row.category,
        targetMonth: row.targetMonth,
        priorityLabel: `P${row.priority}`,
        stateLabel: presentation.label,
        tone: presentation.tone,
        datesLabel: datesLabel(row),
        bar,
    };
}

/**
 * Phase order is foundation, growth, scale. Unset rows are last, labeled
 * "No phase". When every row is unset, returns null so the table stays flat.
 * The count is the number of rows in the group.
 */
export function roadmapPhaseGroups(rows: readonly TimelineRow[]): RoadmapPhaseGroup[] | null {
    if (!rows.some(row => row.phase)) return null;
    const buckets = new Map<InitiativePhase | null, TimelineRow[]>();
    for (const row of rows) {
        const phase = row.phase;
        const list = buckets.get(phase);
        if (list) list.push(row);
        else buckets.set(phase, [row]);
    }
    const groups: RoadmapPhaseGroup[] = [];
    for (const phase of INITIATIVE_PHASES) {
        const grouped = buckets.get(phase);
        if (grouped && grouped.length > 0) groups.push({ phase, label: phaseGroupLabel(phase, grouped.length), rows: grouped });
    }
    const unset = buckets.get(null);
    if (unset && unset.length > 0) groups.push({ phase: null, label: PHASE_UNSET_LABEL, rows: unset });
    return groups;
}

function barFor(initiative: CampaignInitiative, scaleStart: string, scaleEnd: string): TimelineBar | null {
    const start = initiative.startsOn && ISO.test(initiative.startsOn) ? initiative.startsOn : null;
    const end = initiative.endsOn && ISO.test(initiative.endsOn) ? initiative.endsOn : null;
    if (!start && !end) return null;
    if (start && end && start !== end) {
        return {
            kind: 'span',
            start: fraction(start, scaleStart, scaleEnd),
            end: fraction(end, scaleStart, scaleEnd),
        };
    }
    const day = start ?? end;
    if (!day) return null;
    const at = fraction(day, scaleStart, scaleEnd);
    return { kind: 'point', start: at, end: at };
}

export function timelineModel(initiatives: readonly CampaignInitiative[], today: string): TimelineModel {
    const rows = orderedInitiatives(initiatives);
    const dated = rows.flatMap(row => [row.startsOn, row.endsOn].filter((day): day is string => Boolean(day && ISO.test(day))));
    const undatedModel = {
        months: [],
        todayFraction: null,
        todayLabel: null,
        rows: rows.map(row => presentTimelineRow(row, today, null)),
    };
    if (dated.length === 0) return undatedModel;
    const earliest = dated.reduce((min, day) => day < min ? day : min);
    const latest = dated.reduce((max, day) => day > max ? day : max);
    const todayOk = ISO.test(today);
    const includeToday = todayOk
        && Math.abs(isoDayNumber(today) - isoDayNumber(earliest)) <= 31 * 18
        && Math.abs(isoDayNumber(today) - isoDayNumber(latest)) <= 31 * 18;
    const domainStart = includeToday && today < earliest ? today : earliest;
    const domainEnd = includeToday && today > latest ? today : latest;
    const keys = monthsBetween(monthKey(domainStart), monthKey(domainEnd));
    const scaleStart = monthStart(keys[0]);
    const scaleEnd = monthEnd(keys[keys.length - 1]);
    const crossesYear = keys[0].slice(0, 4) !== keys[keys.length - 1].slice(0, 4);
    const todayFraction = includeToday && todayOk ? fraction(today, scaleStart, scaleEnd) : null;
    return {
        months: keys.map(key => {
            const month = MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
            return { key, label: crossesYear ? `${month} ${key.slice(0, 4)}` : month };
        }),
        todayFraction,
        todayLabel: todayFraction == null ? null : `Today · ${formatInitiativeShort(today)}`,
        rows: rows.map(row => presentTimelineRow(row, today, barFor(row, scaleStart, scaleEnd))),
    };
}

/**
 * Delivery from initiatives that actually have evidence. Incomplete verification
 * is omitted. The URL and date are the delivery, never a click or call total.
 */
export function completedDeliveries(initiatives: readonly CampaignInitiative[], today: string): CompletedDelivery[] {
    const deliveries: CompletedDelivery[] = [];
    for (const initiative of orderedInitiatives(initiatives)) {
        const verification = verificationTone(initiative, today);
        if (verification !== 'fresh' && verification !== 'stale') continue;
        const published = [...initiative.items]
            .filter(item => item.contentState === 'published' && safeHttpUrl(item.liveUrl) && item.publishedOn && ISO.test(item.publishedOn))
            .sort((a, b) => (b.publishedOn ?? '').localeCompare(a.publishedOn ?? ''));
        const live = published[0];
        const liveUrl = live ? safeHttpUrl(live.liveUrl) : null;
        if (live && liveUrl && live.publishedOn) {
            deliveries.push({
                id: initiative.id,
                title: initiative.title,
                url: liveUrl,
                dateLabel: formatInitiativeDay(live.publishedOn),
                dateKind: 'published',
                verification,
            });
            continue;
        }
        deliveries.push({
            id: initiative.id,
            title: initiative.title,
            url: safeHttpUrl(initiative.evidenceUrl),
            dateLabel: initiative.verifiedOn ? formatInitiativeDay(initiative.verifiedOn) : null,
            dateKind: initiative.verifiedOn ? 'verified' : null,
            verification,
        });
    }
    return deliveries;
}

/** The metric name is a label. It has no measured value on this object. */
export function measurementStrip(initiative: Pick<CampaignInitiative, 'successMetricLabel'>): { status: 'Not yet measurable'; label: string | null; value: null } {
    const label = initiative.successMetricLabel?.trim() ?? '';
    return { status: 'Not yet measurable', label: label || null, value: null };
}

export function initiativeWriteScope(input: {
    client: { id: string; organizationId: string } | null;
    assertedOrganizationId?: string | null;
}): { ok: true; organizationId: string; clientId: string } | DraftFail {
    if (!input.client?.id || !input.client.organizationId) {
        return { ok: false, error: 'This client is not available.' };
    }
    const asserted = input.assertedOrganizationId?.trim() || null;
    if (asserted && asserted !== input.client.organizationId) {
        return { ok: false, error: 'Client does not belong to this organization.' };
    }
    return { ok: true, organizationId: input.client.organizationId, clientId: input.client.id };
}

function fail(error: string): DraftFail {
    return { ok: false, error };
}

function optionalText(value: string, label: string, max: number): string | null | DraftFail {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > max) return fail(`${label} is too long.`);
    return trimmed;
}

function optionalDate(value: string, label: string): string | null | DraftFail {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!ISO.test(trimmed)) return fail(`${label} is not a date.`);
    const [year, month, day] = trimmed.split('-').map(Number);
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
        return fail(`${label} is not a date.`);
    }
    return trimmed;
}

function optionalChoice<T extends string>(value: string | null | undefined, allowed: readonly T[], label: string): T | null | DraftFail {
    const match = closedMember(value, allowed);
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) return null;
    if (!match) return fail(`${label} is not a roadmap value.`);
    return match;
}

function optionalTargetMonth(value: string | null | undefined): InitiativeTargetMonth | null | DraftFail {
    if (typeof value !== 'string' || !value.trim()) return null;
    const month = readInitiativeTargetMonth(value);
    if (!month) return fail('Target month is not a roadmap value.');
    return month;
}

function optionalUrl(value: string, label: string): string | null | DraftFail {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > 500) return fail(`${label} is too long.`);
    const href = safeHttpUrl(trimmed);
    if (!href) return fail(`${label} needs a full http or https URL.`);
    if (href.length > 500) return fail(`${label} is too long.`);
    return href;
}

function isFail<T>(value: T | DraftFail): value is DraftFail {
    return Boolean(value && typeof value === 'object' && 'ok' in value && value.ok === false);
}

export function normalizeInitiativeDraft(draft: InitiativeDraft): DraftOk | DraftFail {
    const title = draft.title.trim();
    if (!title) return fail('Title is required.');
    if (title.length > 160) return fail('Title is too long.');
    const purpose = optionalText(draft.purpose, 'Purpose', 600);
    if (isFail(purpose)) return purpose;
    const ownerName = optionalText(draft.ownerName, 'Owner', 120);
    if (isFail(ownerName)) return ownerName;
    const phase = optionalChoice(draft.phase, INITIATIVE_PHASES, 'Phase');
    if (isFail(phase)) return phase;
    const category = optionalChoice(draft.category, INITIATIVE_CATEGORIES, 'Category');
    if (isFail(category)) return category;
    const targetMonth = optionalTargetMonth(draft.targetMonth);
    if (isFail(targetMonth)) return targetMonth;
    const priority = Number(draft.priority);
    if (priority !== 1 && priority !== 2 && priority !== 3 && priority !== 4) return fail('Priority is not set.');
    if (!INITIATIVE_STATES.includes(draft.state as InitiativeState)) return fail('State is not set.');
    const state = draft.state as InitiativeState;
    const startsOn = optionalDate(draft.startsOn, 'Start date');
    if (isFail(startsOn)) return startsOn;
    const endsOn = optionalDate(draft.endsOn, 'End date');
    if (isFail(endsOn)) return endsOn;
    if (startsOn && endsOn && endsOn < startsOn) return fail('End date is before the start date.');
    const pageUrl = optionalUrl(draft.pageUrl, 'Page URL');
    if (isFail(pageUrl)) return pageUrl;
    const successMetricLabel = optionalText(draft.successMetricLabel, 'Success metric', 160);
    if (isFail(successMetricLabel)) return successMetricLabel;
    const evidenceUrl = optionalUrl(draft.evidenceUrl, 'Evidence URL');
    if (isFail(evidenceUrl)) return evidenceUrl;
    const verifiedOn = optionalDate(draft.verifiedOn, 'Verification date');
    if (isFail(verifiedOn)) return verifiedOn;
    if (state === 'completed_verified' && (!evidenceUrl || !verifiedOn)) {
        return fail('Completed & Verified needs an evidence URL and a verification date.');
    }
    if (draft.items.length > ITEM_CAP) return fail('A checklist can hold 20 items.');

    const items: InitiativeWriteItem[] = [];
    for (const item of draft.items) {
        const itemTitle = item.title.trim();
        const draftUrl = optionalUrl(item.draftUrl, 'Draft URL');
        if (isFail(draftUrl)) return draftUrl;
        const liveUrl = optionalUrl(item.liveUrl, 'Live URL');
        if (isFail(liveUrl)) return liveUrl;
        const publishedOn = optionalDate(item.publishedOn, 'Publish date');
        if (isFail(publishedOn)) return publishedOn;
        const blank = !itemTitle && !draftUrl && !liveUrl && !publishedOn;
        if (blank) continue;
        if (!itemTitle) return fail('Checklist item title is required.');
        if (itemTitle.length > 160) return fail('Checklist item title is too long.');
        if (!CONTENT_STATES.includes(item.contentState as ContentState)) return fail('Checklist state is not set.');
        const contentState = item.contentState as ContentState;
        if (contentState === 'published' && (!liveUrl || !publishedOn)) {
            return fail('Published needs a live URL and a publish date.');
        }
        const id = item.id && UUID.test(item.id) ? item.id : null;
        items.push({
            id,
            title: itemTitle,
            contentState,
            draftUrl,
            liveUrl,
            publishedOn,
            position: items.length,
        });
    }

    return {
        ok: true,
        value: {
            title,
            purpose,
            ownerName,
            phase,
            category,
            targetMonth,
            priority,
            state,
            startsOn,
            endsOn,
            pageUrl,
            successMetricLabel,
            evidenceUrl,
            verifiedOn,
            items,
        },
    };
}

export function initiativeRow(
    scope: { organizationId: string; clientId: string },
    write: InitiativeWrite,
): Record<string, string | number | null> {
    return {
        organization_id: scope.organizationId,
        client_id: scope.clientId,
        title: write.title,
        purpose: write.purpose,
        owner_name: write.ownerName,
        phase: write.phase,
        category: write.category,
        target_month: write.targetMonth,
        priority: write.priority,
        state: write.state,
        starts_on: write.startsOn,
        ends_on: write.endsOn,
        page_url: write.pageUrl,
        success_metric_label: write.successMetricLabel,
        evidence_url: write.evidenceUrl,
        verified_on: write.verifiedOn,
    };
}

export function initiativeItemRow(
    scope: { organizationId: string; clientId: string },
    initiativeId: string,
    item: InitiativeWriteItem,
): Record<string, string | number | null> {
    return {
        organization_id: scope.organizationId,
        client_id: scope.clientId,
        initiative_id: initiativeId,
        title: item.title,
        content_state: item.contentState,
        draft_url: item.draftUrl,
        live_url: item.liveUrl,
        published_on: item.publishedOn,
        position: item.position,
    };
}

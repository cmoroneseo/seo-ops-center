/**
 * Client Services briefing for Campaign Overview.
 *
 * Five questions, three bands, no new route:
 * Plan — the initiative roadmap.
 * Proof — verified work, started work, and scope versus delivered.
 * Results — Search Console and Business Profile, kept off the proof.
 *
 * `engagementModel` "Campaign" is the older fixed-budget contract. This file
 * calls that a campaign package so it is not the Campaign workspace.
 * Stored config hours are never the logged total. A missing promise is unset.
 */

import type { FulfillmentCell } from '@/lib/types';
import { formatHourAmount } from '@/lib/hour-format';
import { sumBudgetHoursByClient } from '@/lib/time-budget-logic';
import {
    formatInitiativeDay,
    initiativeDatesLabel,
    orderedInitiatives,
    safeHttpUrl,
    statePresentation,
    verificationTone,
    type CampaignInitiative,
    type InitiativeState,
    type InitiativeTone,
} from './initiatives';

const STARTED: readonly InitiativeState[] = ['in_progress', 'awaiting_approval', 'blocked', 'on_hold'];
const CONTENT_ORDER = ['Content', 'Backlink', 'GBP', 'Other'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export type ContractKind = 'retainer' | 'campaign_package';

export interface RecurringDeliverable {
    type: string;
    count: number;
}

/** Contract facts the scope strip is allowed to read. Logged time is separate. */
export interface EngagementFacts {
    contract: ContractKind;
    monthlyHours: number | null;
    totalHours: number | null;
    engagementStart: string | null;
    engagementEnd: string | null;
    recurringDeliverables: RecurringDeliverable[];
    monthlyBlogQuota: number | null;
    monthlyBacklinkQuota: number | null;
}

export const EMPTY_ENGAGEMENT: EngagementFacts = {
    contract: 'retainer',
    monthlyHours: null,
    totalHours: null,
    engagementStart: null,
    engagementEnd: null,
    recurringDeliverables: [],
    monthlyBlogQuota: null,
    monthlyBacklinkQuota: null,
};

export interface HoursLine {
    basis: 'monthly' | 'engagement_total' | 'unset';
    promisedHours: number | null;
    usedHours: number | null;
    promisedText: string;
    usedText: string;
    periodText: string;
    note: string;
}

export interface ContentLine {
    type: string;
    label: string;
    promised: number | null;
    delivered: number | null;
    promisedText: string;
    deliveredText: string;
}

export interface ScopeBrief {
    monthLabel: string;
    hours: HoursLine;
    content: ContentLine[];
    contentState: 'listed' | 'not_set' | 'not_measured';
}

export interface RoadmapBriefRow {
    id: string;
    title: string;
    purpose: string;
    owner: string;
    dates: string;
    pageUrl: string | null;
    stateLabel: string;
    tone: InitiativeTone;
}

export type HoursWindow =
    | { kind: 'month'; month: string }
    | { kind: 'range'; start: string; end: string }
    | { kind: 'unavailable' };

type CellSlice = Pick<FulfillmentCell, 'type' | 'promised' | 'promisedConfigured' | 'delivered'>;

const DELIVERY_NOTE = 'Meeting the hour or content count is delivery for the period. It is not an SEO result.';

function isoDay(value: string | null | undefined): string | null {
    if (!value) return null;
    const day = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Non-positive hours are unset. The client mapper writes 0 when the column is null. */
export function configuredHours(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    return Math.round(value * 100) / 100;
}

function configuredCount(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    return value;
}

export function formatBriefMonth(month: string): string {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
    if (!match) return 'This period';
    return `${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

export function engagementFromClient(client: {
    engagementModel?: string | null;
    retainerConfig?: {
        monthlyHours?: number | null;
        recurringDeliverables?: RecurringDeliverable[] | null;
    } | null;
    campaignConfig?: {
        totalHours?: number | null;
        startDate?: string | null;
        endDate?: string | null;
        monthlyBlogQuota?: number | null;
        monthlyBacklinkQuota?: number | null;
    } | null;
}): EngagementFacts {
    const contract: ContractKind = client.engagementModel === 'Campaign' ? 'campaign_package' : 'retainer';
    const recurring = contract === 'retainer' ? client.retainerConfig?.recurringDeliverables ?? [] : [];
    return {
        contract,
        monthlyHours: contract === 'retainer' ? configuredHours(client.retainerConfig?.monthlyHours) : null,
        totalHours: contract === 'campaign_package' ? configuredHours(client.campaignConfig?.totalHours) : null,
        engagementStart: contract === 'campaign_package' ? isoDay(client.campaignConfig?.startDate) : null,
        engagementEnd: contract === 'campaign_package' ? isoDay(client.campaignConfig?.endDate) : null,
        recurringDeliverables: recurring
            .filter(item => item && configuredCount(item.count) != null && item.type.trim())
            .map(item => ({ type: item.type, count: item.count })),
        monthlyBlogQuota: contract === 'campaign_package' ? configuredCount(client.campaignConfig?.monthlyBlogQuota) : null,
        monthlyBacklinkQuota: contract === 'campaign_package' ? configuredCount(client.campaignConfig?.monthlyBacklinkQuota) : null,
    };
}

/**
 * Which logged-time window answers the hour question.
 * A retainer uses the briefing month. A campaign package uses the engagement
 * dates. Missing package dates stay unavailable so a month of logs is not
 * labeled as the whole budget.
 */
export function hoursWindow(engagement: EngagementFacts, month: string): HoursWindow {
    if (engagement.contract === 'campaign_package') {
        const start = engagement.engagementStart;
        const end = engagement.engagementEnd;
        if (start && end && end >= start) return { kind: 'range', start, end };
        return { kind: 'unavailable' };
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { kind: 'unavailable' };
    return { kind: 'month', month };
}

/** Budget hours inside an engagement range. Internal work and off-budget entries stay out. */
export function budgetHoursInRange(
    logs: readonly { clientId?: string; hours: number; countsTowardBudget: boolean; date: string }[],
    clientId: string,
    start: string,
    end: string,
): number {
    const inRange = logs.filter(log => {
        const day = log.date.slice(0, 10);
        return day >= start && day <= end;
    });
    return sumBudgetHoursByClient(inRange)[clientId] ?? 0;
}

function hoursLine(engagement: EngagementFacts, month: string, loggedHours: number | null): HoursLine {
    const usedText = (hours: number | null) => hours == null ? 'Not measured' : `${formatHourAmount(hours)} h logged`;
    if (engagement.contract === 'campaign_package') {
        const dated = hoursWindow(engagement, month).kind === 'range';
        const promised = engagement.totalHours;
        const used = dated ? loggedHours : null;
        return {
            basis: promised == null ? 'unset' : 'engagement_total',
            promisedHours: promised,
            usedHours: used,
            promisedText: promised == null ? 'Not set' : `${formatHourAmount(promised)} h total`,
            usedText: usedText(used),
            periodText: dated && engagement.engagementStart && engagement.engagementEnd
                ? `${formatInitiativeDay(engagement.engagementStart)} – ${formatInitiativeDay(engagement.engagementEnd)}`
                : 'Dates not set',
            note: `Total hour budget for the engagement dates, not hours per month. Logged hours are time entries in those dates that count toward the SEO budget. ${DELIVERY_NOTE}`,
        };
    }
    const promised = engagement.monthlyHours;
    return {
        basis: promised == null ? 'unset' : 'monthly',
        promisedHours: promised,
        usedHours: loggedHours,
        promisedText: promised == null ? 'Not set' : `${formatHourAmount(promised)} h this month`,
        usedText: usedText(loggedHours),
        periodText: formatBriefMonth(month),
        note: `Hours logged this month that count toward the SEO budget. Internal time and entries flagged off the budget are excluded. ${DELIVERY_NOTE}`,
    };
}

function contentLabel(type: string, quota: boolean): string {
    if (quota && type === 'Content') return 'Blog posts';
    if (type === 'Backlink') return 'Backlinks';
    if (type === 'GBP') return 'Business Profile deliverables';
    if (type === 'Content') return 'Content';
    if (type === 'Other') return 'Other';
    return type;
}

function contentLines(
    engagement: EngagementFacts,
    cells: readonly CellSlice[] | null,
): { lines: ContentLine[]; state: ScopeBrief['contentState'] } {
    const measured = cells != null;
    const byType = new Map<string, CellSlice>();
    for (const cell of cells ?? []) byType.set(cell.type, cell);
    const covered = new Set<string>();
    const lines: ContentLine[] = [];

    const push = (type: string, label: string, promised: number | null, delivered: number | null) => {
        lines.push({
            type,
            label,
            promised,
            delivered,
            promisedText: promised == null ? 'Not set' : String(promised),
            deliveredText: delivered == null ? 'Not measured' : String(delivered),
        });
        covered.add(type);
    };

    if (cells) {
        for (const cell of cells) {
            if (!cell.promisedConfigured || covered.has(cell.type)) continue;
            push(cell.type, contentLabel(cell.type, false), cell.promised, cell.delivered);
        }
    }

    if (engagement.contract === 'retainer') {
        for (const item of engagement.recurringDeliverables) {
            if (covered.has(item.type)) continue;
            const cell = byType.get(item.type);
            push(item.type, contentLabel(item.type, false), item.count, measured ? cell?.delivered ?? 0 : null);
        }
    } else {
        if (engagement.monthlyBlogQuota != null && !covered.has('Content')) {
            const cell = byType.get('Content');
            push('Content', contentLabel('Content', true), engagement.monthlyBlogQuota, measured ? cell?.delivered ?? 0 : null);
        }
        if (engagement.monthlyBacklinkQuota != null && !covered.has('Backlink')) {
            const cell = byType.get('Backlink');
            push('Backlink', contentLabel('Backlink', true), engagement.monthlyBacklinkQuota, measured ? cell?.delivered ?? 0 : null);
        }
    }

    if (cells) {
        for (const cell of cells) {
            if (cell.promisedConfigured || covered.has(cell.type)) continue;
            push(cell.type, contentLabel(cell.type, false), null, cell.delivered);
        }
    }

    lines.sort((a, b) => {
        const left = CONTENT_ORDER.indexOf(a.type);
        const right = CONTENT_ORDER.indexOf(b.type);
        const rankA = left === -1 ? CONTENT_ORDER.length : left;
        const rankB = right === -1 ? CONTENT_ORDER.length : right;
        return rankA - rankB || a.label.localeCompare(b.label);
    });

    if (lines.length > 0) return { lines, state: 'listed' };
    return { lines, state: measured ? 'not_set' : 'not_measured' };
}

export function scopeBrief(input: {
    engagement: EngagementFacts;
    month: string;
    loggedHours: number | null;
    cells: readonly CellSlice[] | null;
}): ScopeBrief {
    const content = contentLines(input.engagement, input.cells);
    return {
        monthLabel: formatBriefMonth(input.month),
        hours: hoursLine(input.engagement, input.month, input.loggedHours),
        content: content.lines,
        contentState: content.state,
    };
}

/** Initiative roadmap only. An empty list stays empty. */
export function roadmapRows(initiatives: readonly CampaignInitiative[], today: string): RoadmapBriefRow[] {
    return orderedInitiatives(initiatives).map(item => {
        const presentation = statePresentation(item, today);
        const owner = item.ownerName?.trim() ?? '';
        const purpose = item.purpose?.trim() ?? '';
        return {
            id: item.id,
            title: item.title,
            purpose: purpose || 'Purpose not set',
            owner: owner || 'Owner not set',
            dates: initiativeDatesLabel(item),
            pageUrl: safeHttpUrl(item.pageUrl),
            stateLabel: presentation.label,
            tone: presentation.tone,
        };
    });
}

/**
 * Started initiatives that are not verified. Planned work stays on the roadmap.
 * Fresh and stale Completed & Verified stay on the verified list.
 * A task status is not an input.
 */
export function inProgressInitiatives(initiatives: readonly CampaignInitiative[], today: string): CampaignInitiative[] {
    return orderedInitiatives(initiatives).filter(item => {
        const verification = verificationTone(item, today);
        if (verification === 'fresh' || verification === 'stale') return false;
        if (verification === 'incomplete') return true;
        return STARTED.includes(item.state);
    });
}

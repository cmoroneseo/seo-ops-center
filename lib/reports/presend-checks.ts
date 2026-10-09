/**
 * Pre-send checks for one report. Blocking checks stop Approve.
 * Warnings stay visible and do not. A missing portal contact is a banner,
 * not a check. Ahrefs errors are warnings even when the sync failed.
 */

import { findClientCopyViolations } from './copy-rules';
import { FRESH_WINDOW_MS } from '@/lib/reporting/freshness';
import { monthLabel } from './sections';

export type PresendSeverity = 'blocking' | 'warn';

export type PresendCheckId =
    | 'month_final'
    | 'sync_error'
    | 'stale_data'
    | 'rank_cliff'
    | 'no_work'
    | 'gsc_real_zero'
    | 'missing_proof'
    | 'client_copy';

export interface PresendCheck {
    id: PresendCheckId;
    source?: string;
    severity: PresendSeverity;
    ok: boolean;
    message: string;
}

export interface PresendBanner {
    id: 'no_recipient';
    message: string;
}

export interface SourceHealth {
    source: 'gsc' | 'ga4' | 'gbp' | 'ahrefs';
    connected: boolean;
    errored: boolean;
    lastSyncedAt: string | null;
}

export interface GscReadout {
    connected: boolean;
    final: boolean;
    clicks: number | null;
    impressions: number | null;
    lastSyncedAt: string | null;
    errored: boolean;
}

export interface RankObservation {
    position: number | null;
}

export interface PresendInput {
    reportMonth: string;
    now: Date;
    gsc: GscReadout;
    sources: SourceHealth[];
    rankChecks: RankObservation[];
    hours: number;
    tasksCompleted: number;
    shipped: number;
    missingProofCount: number;
    copyText: string;
    copySources: readonly string[];
    amNote: string | null;
    hasRecipient: boolean;
}

export interface PresendResult {
    checks: PresendCheck[];
    banners: PresendBanner[];
    canApprove: boolean;
    canSchedule: boolean;
}

const NO_RECIPIENT = 'No portal contact on file. You can approve; scheduling waits for a recipient.';

function asOf(iso: string | null): string {
    if (!iso) return 'the last sync';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'the last sync';
    return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(date);
}

function stale(source: SourceHealth, now: Date): boolean {
    if (!source.connected || source.errored) return false;
    if (!source.lastSyncedAt) return true;
    const at = new Date(source.lastSyncedAt);
    if (Number.isNaN(at.getTime())) return true;
    return now.getTime() - at.getTime() > FRESH_WINDOW_MS[source.source];
}

/** A single rank check is never a drop. A cliff needs two positions, 10 or more worse. */
export function rankCliff(checks: RankObservation[]): boolean {
    const positions = checks
        .map(check => check.position)
        .filter((position): position is number => typeof position === 'number' && Number.isFinite(position));
    if (positions.length < 2) return false;
    const previous = positions[positions.length - 2];
    const latest = positions[positions.length - 1];
    return latest - previous >= 10;
}

function notePresent(note: string | null): boolean {
    return Boolean(note && note.trim().length > 0);
}

export function evaluatePresendChecks(input: PresendInput): PresendResult {
    const checks: PresendCheck[] = [];
    const month = monthLabel(input.reportMonth);
    const gsc = input.sources.find(source => source.source === 'gsc') ?? {
        source: 'gsc' as const,
        connected: input.gsc.connected,
        errored: input.gsc.errored,
        lastSyncedAt: input.gsc.lastSyncedAt,
    };

    if (!gsc.connected) {
        checks.push({
            id: 'month_final',
            source: 'gsc',
            severity: 'blocking',
            ok: false,
            message: `Search Console isn’t connected, so ${month} isn’t final.`,
        });
    } else if (!input.gsc.final) {
        checks.push({
            id: 'month_final',
            source: 'gsc',
            severity: 'blocking',
            ok: false,
            message: `${month} search data is not final (last sync ${asOf(input.gsc.lastSyncedAt ?? gsc.lastSyncedAt)}).`,
        });
    } else {
        checks.push({
            id: 'month_final',
            source: 'gsc',
            severity: 'blocking',
            ok: true,
            message: `${month} search data is final.`,
        });
    }

    for (const source of input.sources) {
        if (!source.connected) continue;
        if (source.errored) {
            const ahrefs = source.source === 'ahrefs';
            checks.push({
                id: 'sync_error',
                source: source.source,
                severity: ahrefs ? 'warn' : source.source === 'gsc' ? 'blocking' : 'warn',
                ok: false,
                message: ahrefs
                    ? 'Ahrefs error. This does not block approval.'
                    : source.source === 'gsc'
                        ? `Search Console sync failed (last sync ${asOf(source.lastSyncedAt)}).`
                        : source.source === 'gbp'
                            ? `Business Profile sync failed. ${month} actions may be incomplete.`
                            : `${source.source.toUpperCase()} sync failed.`,
            });
            continue;
        }
        if (!stale(source, input.now)) continue;
        const blocking = source.source === 'gsc';
        checks.push({
            id: 'stale_data',
            source: source.source,
            severity: blocking ? 'blocking' : 'warn',
            ok: false,
            message: blocking
                ? `Search data is stale. Last sync ${asOf(source.lastSyncedAt)}.`
                : source.source === 'gbp'
                    ? `Business Profile numbers for ${month} aren’t final yet.`
                    : `${source.source.toUpperCase()} data is stale. Last sync ${asOf(source.lastSyncedAt)}.`,
        });
    }

    if (rankCliff(input.rankChecks)) {
        checks.push({
            id: 'rank_cliff',
            severity: 'warn',
            ok: false,
            message: 'Rank tracker moved by 10 or more between the last two checks. One check is never a drop.',
        });
    }

    const worked = input.hours > 0 || input.tasksCompleted > 0 || input.shipped > 0;
    if (!worked) {
        const noted = notePresent(input.amNote);
        checks.push({
            id: 'no_work',
            severity: 'blocking',
            ok: noted,
            message: noted
                ? `No work was logged for ${month}. The note will show in What we did.`
                : `No work recorded for ${month}. Approve stays off until you write a note for What we did.`,
        });
    }

    const realZero = gsc.connected
        && input.gsc.final
        && input.gsc.clicks === 0
        && input.gsc.impressions === 0;
    if (realZero) {
        const noted = notePresent(input.amNote);
        checks.push({
            id: 'gsc_real_zero',
            severity: 'blocking',
            ok: noted,
            message: noted
                ? `Google recorded no impressions in ${month}. The note will show in What we did.`
                : `Google didn’t show this website for any searches in ${month}. Approve stays off until you write a note.`,
        });
    }

    if (input.missingProofCount > 0) {
        checks.push({
            id: 'missing_proof',
            severity: 'warn',
            ok: false,
            message: `${input.missingProofCount} published ${input.missingProofCount === 1 ? 'item is' : 'items are'} missing a live URL or ship date.`,
        });
    }

    const violations = findClientCopyViolations(input.copyText, input.copySources);
    if (violations.length > 0) {
        checks.push({
            id: 'client_copy',
            severity: 'blocking',
            ok: false,
            message: `Rewrite the client copy before approving (${violations.map(item => item.term).join(', ')}).`,
        });
    }

    const banners: PresendBanner[] = input.hasRecipient ? [] : [{ id: 'no_recipient', message: NO_RECIPIENT }];
    const canApprove = checks.every(check => check.severity !== 'blocking' || check.ok);
    return { checks, banners, canApprove, canSchedule: input.hasRecipient };
}

export const NO_RECIPIENT_BANNER = NO_RECIPIENT;

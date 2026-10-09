/**
 * When a frozen report is allowed to send: business day 5 of the following
 * month, 9:00 AM Pacific, and only while that hour is open.
 */

import { ptToday } from '@/lib/sync/months';
import { instantAtPt, isBusinessDay, nthBusinessDay, PT_TIME_ZONE } from './business-days';

export const REPORT_SEND_HOUR_PT = 9;
export const REPORT_SEND_CRON_HOURS_UTC = [16, 17] as const;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type SendStatus = 'queued' | 'sent' | 'skipped_no_contact' | 'canceled';

export interface DueReview {
    reviewId: string;
    reportId: string;
    versionId: string;
    organizationId: string;
    clientId: string;
    state: string;
    scheduledFor: string | null;
    reportMonth: string;
    contactId: string | null;
    sendStatus: SendStatus | null;
}

export interface PlannedSend {
    action: 'email' | 'portal_only' | 'skip';
    reason: 'due' | 'retry' | 'no_contact' | 'not_approved' | 'already_sent' | 'already_flagged' | 'not_due' | 'invalid';
    review: DueReview;
    /** True when this version does not have a report_sends row yet. */
    insert: boolean;
    scheduledFor: string | null;
}

function ptHour(now: Date): number {
    const bag = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: PT_TIME_ZONE,
        hourCycle: 'h23',
        hour: '2-digit',
    }).formatToParts(now).map(part => [part.type, part.value]));
    const hour = Number(bag.hour);
    return hour === 24 ? 0 : hour;
}

export function sendWindowOpen(now: Date, extraHolidays: readonly string[] = []): boolean {
    if (ptHour(now) !== REPORT_SEND_HOUR_PT) return false;
    return isBusinessDay(ptToday(now), extraHolidays);
}

function monthAfter(month: string): string | null {
    const match = MONTH.exec(month);
    if (!match) return null;
    let year = Number(match[1]);
    let monthNumber = Number(match[2]) + 1;
    if (monthNumber === 13) {
        monthNumber = 1;
        year += 1;
    }
    return `${year}-${String(monthNumber).padStart(2, '0')}`;
}

/** Business day 5 of the month after the report, at 9:00 AM Pacific. */
export function reportSendTarget(reportMonth: string, extraHolidays: readonly string[] = []): Date | null {
    const month = monthAfter(reportMonth);
    if (!month) return null;
    const day = nthBusinessDay(month, 5, extraHolidays);
    if (!day) return null;
    return instantAtPt(day, REPORT_SEND_HOUR_PT, 0);
}

function targetInstant(review: DueReview, extraHolidays: readonly string[]): Date | null {
    if (review.scheduledFor) {
        const date = new Date(review.scheduledFor);
        if (Number.isNaN(date.getTime())) return null;
        return date;
    }
    return reportSendTarget(review.reportMonth, extraHolidays);
}

export function planReportSends(input: {
    now: Date;
    reviews: DueReview[];
    extraHolidays?: readonly string[];
}): PlannedSend[] {
    const extra = input.extraHolidays ?? [];
    return input.reviews.map(review => {
        const approved = review.state === 'approved' || review.state === 'scheduled';
        if (!approved || !review.versionId) {
            return { action: 'skip' as const, reason: 'not_approved' as const, review, insert: false, scheduledFor: review.scheduledFor };
        }
        if (review.sendStatus === 'sent') {
            return { action: 'skip' as const, reason: 'already_sent' as const, review, insert: false, scheduledFor: review.scheduledFor };
        }
        if (review.sendStatus === 'skipped_no_contact' || review.sendStatus === 'canceled') {
            return { action: 'skip' as const, reason: 'already_flagged' as const, review, insert: false, scheduledFor: review.scheduledFor };
        }
        const instant = targetInstant(review, extra);
        if (!instant) {
            return { action: 'skip' as const, reason: 'invalid' as const, review, insert: false, scheduledFor: null };
        }
        if (input.now.getTime() < instant.getTime()) {
            return { action: 'skip' as const, reason: 'not_due' as const, review, insert: false, scheduledFor: instant.toISOString() };
        }
        const scheduledFor = instant.toISOString();
        if (!review.contactId) {
            return { action: 'portal_only' as const, reason: 'no_contact' as const, review, insert: review.sendStatus == null, scheduledFor };
        }
        return {
            action: 'email' as const,
            reason: review.sendStatus === 'queued' ? 'retry' as const : 'due' as const,
            review,
            insert: review.sendStatus == null,
            scheduledFor,
        };
    });
}

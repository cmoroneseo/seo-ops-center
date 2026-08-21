import type { TimeLogSegment } from '../types';

export const FIVE_MINUTES_MS = 5 * 60_000;

export interface SegmentSlice {
    segment: TimeLogSegment;
    localDate: string;
    startsAt: string;
    endsAt: string;
    activeSeconds: number;
}

export type SegmentDateSlice = SegmentSlice;

export interface DisplaySegmentGroup {
    startsAt: string;
    endsAt: string;
    activeSeconds: number;
    segments: TimeLogSegment[];
}

interface ResolvedSegment {
    segment: TimeLogSegment;
    startsAt: Date;
    endsAt: Date;
}

function validDate(value: Date): boolean {
    return Number.isFinite(value.getTime());
}

function resolveSegments(segments: TimeLogSegment[], now: Date): ResolvedSegment[] {
    if (!validDate(now)) throw new RangeError('Invalid now date');

    return segments
        .map((segment, index) => {
            if (typeof segment.startedAt !== 'string' || (segment.endedAt !== undefined && typeof segment.endedAt !== 'string')) {
                throw new RangeError('Invalid segment interval');
            }

            const startsAt = new Date(segment.startedAt);
            const endsAt = segment.endedAt === undefined ? now : new Date(segment.endedAt);
            if (!validDate(startsAt) || !validDate(endsAt) || endsAt.getTime() < startsAt.getTime()) {
                throw new RangeError('Invalid segment interval');
            }

            return { segment, startsAt, endsAt, index };
        })
        .sort((left, right) => (
            left.startsAt.getTime() - right.startsAt.getTime()
            || left.endsAt.getTime() - right.endsAt.getTime()
            || left.index - right.index
        ))
        .map(({ segment, startsAt, endsAt }) => ({ segment, startsAt, endsAt }));
}

function activeSeconds(segment: ResolvedSegment): number {
    return (segment.endsAt.getTime() - segment.startsAt.getTime()) / 1_000;
}

function toIsoString(value: Date): string {
    return value.toISOString();
}

function localDateFormatter(timeZone: string): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat('en-US', {
        calendar: 'iso8601',
        day: '2-digit',
        month: '2-digit',
        numberingSystem: 'latn',
        timeZone,
        year: 'numeric',
    });
}

function localDateAt(formatter: Intl.DateTimeFormat, instant: Date): string {
    const values = Object.fromEntries(
        formatter.formatToParts(instant)
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
}

function nextLocalMidnight(formatter: Intl.DateTimeFormat, from: Date): Date {
    const currentDate = localDateAt(formatter, from);
    let low = from.getTime();
    let high = low + 3 * 24 * 60 * 60 * 1_000;

    if (localDateAt(formatter, new Date(high)) === currentDate) {
        throw new RangeError('Unable to resolve the next local date boundary');
    }

    while (high - low > 1) {
        const middle = low + Math.floor((high - low) / 2);
        if (localDateAt(formatter, new Date(middle)) === currentDate) low = middle;
        else high = middle;
    }

    return new Date(high);
}

export function sumActiveSeconds(segments: TimeLogSegment[], now = new Date()): number {
    return resolveSegments(segments, now)
        .reduce((total, segment) => total + activeSeconds(segment), 0);
}

export function groupSegmentsForDisplay(
    segments: TimeLogSegment[],
    thresholdMs = FIVE_MINUTES_MS,
    now = new Date(),
): DisplaySegmentGroup[] {
    if (!Number.isFinite(thresholdMs) || thresholdMs < 0) {
        throw new RangeError('Invalid display gap threshold');
    }

    const resolved = resolveSegments(segments, now);
    const groups: DisplaySegmentGroup[] = [];
    let current: DisplaySegmentGroup | undefined;
    let currentEndMs = 0;

    for (const item of resolved) {
        const startsAtMs = item.startsAt.getTime();
        const endsAtMs = item.endsAt.getTime();
        if (!current || startsAtMs - currentEndMs >= thresholdMs) {
            current = {
                startsAt: toIsoString(item.startsAt),
                endsAt: toIsoString(item.endsAt),
                activeSeconds: activeSeconds(item),
                segments: [item.segment],
            };
            groups.push(current);
            currentEndMs = endsAtMs;
            continue;
        }

        current.activeSeconds += activeSeconds(item);
        current.segments.push(item.segment);
        if (endsAtMs > currentEndMs) {
            current.endsAt = toIsoString(item.endsAt);
            currentEndMs = endsAtMs;
        }
    }

    return groups;
}

export function splitSegmentsByLocalDate(
    segments: TimeLogSegment[],
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
    now = new Date(),
): SegmentDateSlice[] {
    const formatter = localDateFormatter(timeZone);
    const slices: SegmentDateSlice[] = [];

    for (const segment of resolveSegments(segments, now)) {
        let startsAt = segment.startsAt;
        while (startsAt.getTime() < segment.endsAt.getTime()) {
            const endsAt = new Date(Math.min(
                segment.endsAt.getTime(),
                nextLocalMidnight(formatter, startsAt).getTime(),
            ));
            slices.push({
                segment: segment.segment,
                localDate: localDateAt(formatter, startsAt),
                startsAt: toIsoString(startsAt),
                endsAt: toIsoString(endsAt),
                activeSeconds: (endsAt.getTime() - startsAt.getTime()) / 1_000,
            });
            startsAt = endsAt;
        }
    }

    return slices;
}

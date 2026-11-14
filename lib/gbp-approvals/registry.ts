import { z } from 'zod';

/** Payload schema carried on every stored GBP post version. */
export const GBP_POST_SCHEMA_VERSION = 1;

export const GBP_POST_ITEM_TYPE = 'gbp_post';

/** Fields a client can see. Changing any of them clears that item's approval. */
export const GBP_CLIENT_VISIBLE_FIELDS = [
    'postType',
    'title',
    'body',
    'offerStart',
    'offerEnd',
    'scheduledDate',
    'ctaUrl',
    'ctaLabel',
    'terms',
    'photo',
] as const;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(value: string): boolean {
    const match = CALENDAR_DATE.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

const calendarDate = z.string().refine(isCalendarDate, 'Use a real calendar date.');

export const gbpPostPayloadSchema = z.object({
    schemaVersion: z.literal(GBP_POST_SCHEMA_VERSION),
    postType: z.enum(['offer', 'update', 'event']),
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(2000),
    offerStart: calendarDate.nullable(),
    offerEnd: calendarDate.nullable(),
    scheduledDate: calendarDate,
    ctaUrl: z.string().regex(/^https:\/\/\S+$/).max(500),
    ctaLabel: z.string().trim().min(1).max(40),
    terms: z.string().trim().max(1000),
}).superRefine((value, context) => {
    if (value.postType === 'offer' && (!value.offerStart || !value.offerEnd)) {
        context.addIssue({ code: 'custom', message: 'An offer needs a start and end date.', path: ['offerStart'] });
    }
    if ((value.offerStart && !value.offerEnd) || (!value.offerStart && value.offerEnd)) {
        context.addIssue({ code: 'custom', message: 'Set both offer dates, or neither.', path: ['offerEnd'] });
    }
    if (value.offerStart && value.offerEnd && value.offerEnd < value.offerStart) {
        context.addIssue({ code: 'custom', message: 'The offer end is before the start.', path: ['offerEnd'] });
    }
});

export type GbpPostPayload = z.infer<typeof gbpPostPayloadSchema>;

export function parseGbpPostPayload(value: unknown): { ok: true; payload: GbpPostPayload } | { ok: false; error: string } {
    const parsed = gbpPostPayloadSchema.safeParse(value);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return { ok: false, error: issue?.message ?? 'This post is missing a required field.' };
    }
    return { ok: true, payload: parsed.data };
}

/**
 * A suggestion only replaces the title or the body. The scheduled date and the
 * other offer fields stay on the version the agency already set.
 */
export function applySuggestion(
    payload: GbpPostPayload,
    suggestion: { title?: string | null; body?: string | null },
): GbpPostPayload {
    return {
        ...payload,
        ...(suggestion.title ? { title: suggestion.title } : {}),
        ...(suggestion.body ? { body: suggestion.body } : {}),
    };
}

export function visibleSnapshot(payload: GbpPostPayload, photo: string | null): Record<string, string> {
    return {
        postType: payload.postType,
        title: payload.title,
        body: payload.body,
        offerStart: payload.offerStart ?? '',
        offerEnd: payload.offerEnd ?? '',
        scheduledDate: payload.scheduledDate,
        ctaUrl: payload.ctaUrl,
        ctaLabel: payload.ctaLabel,
        terms: payload.terms,
        photo: photo ?? '',
    };
}

export function clientVisibleChange(before: Record<string, string>, after: Record<string, string>): boolean {
    return GBP_CLIENT_VISIBLE_FIELDS.some(field => before[field] !== after[field]);
}

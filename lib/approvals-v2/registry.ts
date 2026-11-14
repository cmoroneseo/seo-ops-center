import { z } from 'zod';
import { gbpPostPayloadSchema, GBP_CLIENT_VISIBLE_FIELDS, visibleSnapshot, applySuggestion, isCalendarDate } from '../gbp-approvals/registry.ts';

export interface ApprovalType<P> {
    type: 'gbp_post' | 'page';
    schemaVersion: 1;
    schema: z.ZodType<P>;
    clientVisibleFields: readonly string[];
    suggestionFields: readonly string[];
    maxPayloadBytes: number;
    visibleSnapshot(payload: P, asset: string | null): Record<string, string>;
    applySuggestion(payload: P, suggestion: Record<string, string>): P;
}

export const pagePayloadSchema = z.object({
    schemaVersion: z.literal(1),
    pageKind: z.enum(['blog', 'service', 'city']),
    title: z.string().min(1).max(200),
    metaTitle: z.string().min(1).max(120),
    metaDescription: z.string().max(320),
    slug: z.string().max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/),
    plannedDate: z.string().refine(isCalendarDate).optional(),
    targetKeyword: z.string().max(120).optional(),
    mockupAlt: z.string().max(200).optional(),
    body: z.object({ type: z.literal('doc'), content: z.array(z.unknown()) }).passthrough(),
});
export type PagePayload = z.infer<typeof pagePayloadSchema>;

/** Canonical JSON for comparisons; anchor identity attrs are not visible content. */
export function canonicalJson(value: unknown): string {
    function clean(input: unknown, attrs = false): unknown {
        if (Array.isArray(input)) return input.map(entry => clean(entry));
        if (input !== null && typeof input === 'object') {
            return Object.fromEntries(Object.entries(input).sort(([a], [b]) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')))
                .filter(([key]) => !attrs || !['sectionId', 'blockId'].includes(key))
                .map(([key, entry]) => [key, clean(entry, key === 'attrs')]));
        }
        return input;
    }
    return JSON.stringify(clean(value));
}

export const gbpPostType: ApprovalType<z.infer<typeof gbpPostPayloadSchema>> = {
    type: 'gbp_post', schemaVersion: 1, schema: gbpPostPayloadSchema,
    clientVisibleFields: GBP_CLIENT_VISIBLE_FIELDS, suggestionFields: ['title', 'body'],
    maxPayloadBytes: 16384, visibleSnapshot, applySuggestion,
};
export const pageType: ApprovalType<PagePayload> = {
    type: 'page', schemaVersion: 1, schema: pagePayloadSchema,
    clientVisibleFields: ['pageKind', 'title', 'metaTitle', 'metaDescription', 'slug', 'plannedDate', 'body', 'mockupAlt', 'photo'],
    suggestionFields: [], maxPayloadBytes: 1048576,
    visibleSnapshot(payload, photo) {
        const { targetKeyword: _targetKeyword, ...visible } = payload;
        void _targetKeyword;
        return Object.fromEntries(Object.entries({ ...visible, photo: photo ?? '' })
            .map(([key, value]) => [key, typeof value === 'string' ? value : canonicalJson(value)]));
    },
    applySuggestion(payload, suggestion) {
        return pagePayloadSchema.parse({ ...payload, ...Object.fromEntries(Object.entries(suggestion)
            .filter(([key]) => pageType.suggestionFields.includes(key))) });
    },
};
export const approvalTypes = { gbp_post: gbpPostType, page: pageType } as const;

import { safeHref } from '../links/safe-href.ts';
import type { TimeLogReferenceLink } from '../types.ts';

/**
 * The document links an imported entry carries.
 *
 * The team attaches Google Docs to their time notes — a reviewed August entry
 * read "created updated SEO roadmap draft: All In One Construction - 6-Month
 * SEO Roadmap" with the doc name as a live hyperlink. Held as structured data
 * rather than free text, a client-month review can list the artifacts a month
 * actually produced.
 */

/**
 * One row is a description of one block of time, not an attachment store. Ten
 * is well past what any reviewed entry carries and bounds what a single row
 * can push into every reader downstream.
 */
export const MAX_REFERENCE_LINKS = 10;

/** Long enough for a real document title, short enough to stay a label. */
export const MAX_REFERENCE_LABEL_LENGTH = 200;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

/**
 * Read links back out of the jsonb column.
 *
 * Deliberately lossy rather than throwing: this parses a database value, and a
 * row written before a validation rule existed — or by a future writer — must
 * still render. Anything unrecognizable is dropped, never surfaced. The URL
 * goes through the same `safeHref` allowlist the renderers use, so a stored
 * `javascript:` href cannot reach the UI even if one somehow got written.
 */
export function parseReferenceLinks(value: unknown): TimeLogReferenceLink[] {
    if (!Array.isArray(value)) return [];

    const links: TimeLogReferenceLink[] = [];
    for (const entry of value) {
        if (links.length >= MAX_REFERENCE_LINKS) break;
        const record = asRecord(entry);
        if (!record) continue;
        if (typeof record.label !== 'string' || typeof record.url !== 'string') continue;

        const label = record.label.trim().slice(0, MAX_REFERENCE_LABEL_LENGTH);
        if (!label) continue;
        const url = safeHref(record.url.trim());
        if (!url) continue;

        links.push({ label, url });
    }
    return links;
}

export type ReferenceLinkValidation =
    | { ok: true; links: TimeLogReferenceLink[] }
    | { ok: false; error: string };

/**
 * Check links on the way in.
 *
 * The mirror image of `parseReferenceLinks`: nothing is silently dropped here,
 * because a person just typed it and needs to be told what was wrong.
 */
export function validateReferenceLinks(links: unknown): ReferenceLinkValidation {
    if (links === undefined || links === null) return { ok: true, links: [] };
    if (!Array.isArray(links)) {
        return { ok: false, error: 'Reference links must be a list' };
    }
    if (links.length > MAX_REFERENCE_LINKS) {
        return {
            ok: false,
            error: `An entry can carry at most ${MAX_REFERENCE_LINKS} links`,
        };
    }

    const validated: TimeLogReferenceLink[] = [];
    for (const entry of links) {
        const record = asRecord(entry);
        if (!record) {
            return { ok: false, error: 'Each link needs a label and a URL' };
        }
        if (typeof record.label !== 'string' || typeof record.url !== 'string') {
            return { ok: false, error: 'Each link needs a label and a URL' };
        }

        const label = record.label.trim();
        if (!label) {
            return { ok: false, error: 'Give the link a label' };
        }
        if (label.length > MAX_REFERENCE_LABEL_LENGTH) {
            return {
                ok: false,
                error: `Link labels are limited to ${MAX_REFERENCE_LABEL_LENGTH} characters`,
            };
        }

        const url = safeHref(record.url.trim());
        if (!url) {
            return { ok: false, error: `"${label}" needs a valid http or https link` };
        }

        validated.push({ label, url });
    }

    return { ok: true, links: validated };
}

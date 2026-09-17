import type { ContentAnchor } from '../types';

/**
 * Comment and suggestion anchoring.
 *
 * The review lock (a document is either open for review or open for editing, never both)
 * means client comments always arrive against a frozen version, and the writer then edits
 * from that exact base. So anchors move only through ProseMirror transactions, and
 * `tr.mapping` carries them forward exactly — no fuzzy text matching is needed.
 *
 * What remains is detecting when an anchor has been invalidated, and never throwing the
 * comment away when it has. Silently losing client feedback is the worst failure mode
 * this feature has.
 */

/** Structural subset of ProseMirror's `Mapping` — lets this stay a pure module. */
export interface PositionMapper {
    map(pos: number, assoc?: number): number;
}

/** How much surrounding text to keep as the repair kit when an anchor is created. */
export const CONTEXT_CHARS = 40;

export function buildAnchor(
    from: number,
    to: number,
    docText: string,
): ContentAnchor {
    return {
        from,
        to,
        quotedText: docText.slice(from, to),
        prefix: docText.slice(Math.max(0, from - CONTEXT_CHARS), from),
        suffix: docText.slice(to, to + CONTEXT_CHARS),
    };
}

/**
 * Carry an anchor through one transaction.
 *
 * The `assoc` biases are +1 on the start and -1 on the end — both pointing INWARD — so
 * that text typed at either boundary lands outside the highlight. The intuitive pairing
 * (-1, +1) is wrong: it keeps `from` before an insertion at the start boundary, so the
 * highlight silently swallows newly typed text the client never commented on.
 *
 * Returns null when the range has collapsed — the anchored text was deleted outright.
 * The caller marks the comment orphaned; it never deletes it.
 */
export function mapAnchor(
    anchor: ContentAnchor,
    mapping: PositionMapper,
): ContentAnchor | null {
    const from = mapping.map(anchor.from, 1);
    const to = mapping.map(anchor.to, -1);
    if (to <= from) return null;
    return { ...anchor, from, to };
}

export function mapAnchors<T extends { anchor?: ContentAnchor | null }>(
    items: T[],
    mapping: PositionMapper,
): Array<{ item: T; anchor: ContentAnchor | null; orphaned: boolean }> {
    return items.map((item) => {
        if (!item.anchor) return { item, anchor: null, orphaned: false };
        const next = mapAnchor(item.anchor, mapping);
        return { item, anchor: next, orphaned: next === null };
    });
}

/** Whitespace and quote-style differences are noise when comparing anchored text. */
export function normalizeForMatch(s: string): string {
    return s
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

export type AnchorDrift = 'intact' | 'modified' | 'orphaned';

/**
 * Compare an anchor against the document it now points into.
 *
 * `modified` is not a failure — the reviewer's comment still points at the right region,
 * the words inside it just changed. It exists so the UI can say "the text under this
 * comment has been edited since" rather than pretending nothing happened.
 */
export function anchorDrift(
    anchor: ContentAnchor | null,
    docText: string,
): AnchorDrift {
    if (!anchor) return 'orphaned';
    if (anchor.to <= anchor.from) return 'orphaned';
    if (anchor.from < 0 || anchor.to > docText.length) return 'orphaned';
    const current = docText.slice(anchor.from, anchor.to);
    if (normalizeForMatch(current) === normalizeForMatch(anchor.quotedText)) return 'intact';
    return 'modified';
}

/**
 * Non-overlapping ranges for rendering, so stacked highlights stay legible.
 *
 * Splits a set of overlapping anchors into segments, each carrying the ids covering it.
 * The renderer varies tint intensity by `ids.length` instead of painting opaque blocks
 * that hide the text underneath.
 */
export interface HighlightSegment {
    from: number;
    to: number;
    ids: string[];
}

export function segmentHighlights(
    anchors: Array<{ id: string; anchor: ContentAnchor }>,
): HighlightSegment[] {
    if (anchors.length === 0) return [];

    const edges = new Set<number>();
    for (const { anchor } of anchors) {
        edges.add(anchor.from);
        edges.add(anchor.to);
    }
    const points = [...edges].sort((a, b) => a - b);

    const segments: HighlightSegment[] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
        const from = points[i];
        const to = points[i + 1];
        const ids = anchors
            .filter(({ anchor }) => anchor.from <= from && anchor.to >= to)
            .map(({ id }) => id);
        if (ids.length > 0) segments.push({ from, to, ids });
    }
    return segments;
}

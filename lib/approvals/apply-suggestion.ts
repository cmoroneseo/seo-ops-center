import { getSchema } from '@tiptap/core';
import { Node as PMNode, type Schema } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';

import { approvalEditorExtensions } from './editor-extensions';
import { normalizeForMatch } from './anchoring';
import type { ContentAnchor, SuggestionKind } from '../types';

/**
 * Applying an accepted client suggestion to the working draft.
 *
 * Because the app owns the document after import, accepting is a real edit rather than a
 * note for someone to re-key in Google Docs. Kept pure — no editor instance, no DOM — so
 * it runs identically on the server and under `node:test`.
 */

export interface ApplicableSuggestion {
    id: string;
    kind: SuggestionKind;
    anchor: ContentAnchor;
    payload: string;
}

export interface ApplyResult {
    doc: Record<string, unknown>;
    applied: string[];
    /** Suggestions that could not be applied, with the reason, so nothing fails silently. */
    skipped: Array<{ id: string; reason: string }>;
}

let cachedSchema: Schema | null = null;

/** The schema must match the editor's, or a patched document will not round-trip. */
export function approvalSchema(): Schema {
    if (!cachedSchema) cachedSchema = getSchema(approvalEditorExtensions());
    return cachedSchema;
}

/**
 * Marks of the text being replaced, so the replacement inherits its formatting.
 *
 * `$pos.marks()` is the wrong tool here: at a boundary between an unformatted run and a
 * bold one it returns the marks of the node BEFORE the position, so rewording the first
 * word of a bold phrase would silently strip the bold. `nodeAt` reads the node that
 * actually starts at the position, which is the text being replaced.
 */
function marksAt(node: PMNode, pos: number) {
    try {
        return node.nodeAt(pos)?.marks ?? node.resolve(pos).marks();
    } catch {
        return undefined;
    }
}

function describeMismatch(expected: string, found: string): string {
    return `the text has changed since this was suggested (expected "${expected.slice(0, 40)}", found "${found.slice(0, 40)}")`;
}

/**
 * Apply several suggestions to one document.
 *
 * **Descending position order is load-bearing.** Each edit shifts every position after it,
 * so applying front-to-back invalidates the anchors of everything still queued. Working
 * backwards means untouched anchors stay correct, which is why this takes the whole set
 * rather than being called in a loop by the caller.
 */
export function applySuggestions(
    docJson: Record<string, unknown>,
    suggestions: ApplicableSuggestion[],
): ApplyResult {
    const schema = approvalSchema();

    let node: PMNode;
    try {
        node = PMNode.fromJSON(schema, docJson);
    } catch (error) {
        return {
            doc: docJson,
            applied: [],
            skipped: suggestions.map((s) => ({
                id: s.id,
                reason: `document could not be parsed (${error instanceof Error ? error.message : 'unknown'})`,
            })),
        };
    }

    const applied: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];

    const ordered = [...suggestions].sort((a, b) => b.anchor.from - a.anchor.from);

    // Overlapping suggestions cannot both be right — the second would be applied against
    // text the first already rewrote. Take the first in document order and report the rest.
    let lastFrom = Number.POSITIVE_INFINITY;

    for (const suggestion of ordered) {
        const { from, to } = suggestion.anchor;

        if (from < 0 || to < from || to > node.content.size) {
            skipped.push({ id: suggestion.id, reason: 'the anchored range is no longer inside the document' });
            continue;
        }
        if (to > lastFrom) {
            skipped.push({ id: suggestion.id, reason: 'it overlaps another accepted suggestion' });
            continue;
        }

        // Refuse to patch text that has moved on. A suggestion made against v1 must not
        // silently rewrite different words in v2.
        if (suggestion.kind !== 'insert' && suggestion.anchor.quotedText) {
            const current = node.textBetween(from, to, ' ');
            if (normalizeForMatch(current) !== normalizeForMatch(suggestion.anchor.quotedText)) {
                skipped.push({
                    id: suggestion.id,
                    reason: describeMismatch(suggestion.anchor.quotedText, current),
                });
                continue;
            }
        }

        const transform = new Transform(node);
        try {
            if (suggestion.kind === 'delete') {
                transform.delete(from, to);
            } else if (suggestion.kind === 'insert') {
                if (!suggestion.payload) {
                    skipped.push({ id: suggestion.id, reason: 'the suggestion is empty' });
                    continue;
                }
                transform.replaceWith(from, from, schema.text(suggestion.payload, marksAt(node, from)));
            } else {
                if (!suggestion.payload) {
                    skipped.push({ id: suggestion.id, reason: 'the replacement is empty — use a delete instead' });
                    continue;
                }
                // Carry the marks from the start of the range, so rewording inside a
                // link or a bold run does not strip the formatting around it.
                transform.replaceWith(from, to, schema.text(suggestion.payload, marksAt(node, from)));
            }
        } catch (error) {
            skipped.push({
                id: suggestion.id,
                reason: error instanceof Error ? error.message : 'the edit could not be applied',
            });
            continue;
        }

        node = transform.doc;
        applied.push(suggestion.id);
        lastFrom = from;
    }

    return { doc: node.toJSON() as Record<string, unknown>, applied, skipped };
}

/** Plain text of a stored document, for word counts and previews. */
export function docText(docJson: Record<string, unknown>): string {
    try {
        return PMNode.fromJSON(approvalSchema(), docJson).textBetween(
            0,
            PMNode.fromJSON(approvalSchema(), docJson).content.size,
            '\n',
            ' ',
        );
    } catch {
        return '';
    }
}

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';

import { CONTEXT_CHARS, segmentHighlights } from './anchoring';
import type { ContentAnchor } from '../types';

/**
 * Renders comment and suggestion anchors as ProseMirror decorations.
 *
 * Decorations, not marks: the document JSON stays exactly as imported, so highlights
 * cannot conflict with content, cannot be serialised into a published version, and work
 * identically in the read-only client reader.
 */

export interface AnchoredItem {
    id: string;
    anchor: ContentAnchor;
    /** Suggestions render differently from comments. */
    kind?: 'comment' | 'suggestion';
    resolved?: boolean;
}

export interface CommentHighlightOptions {
    items: AnchoredItem[];
    activeId: string | null;
    /** Fired after a doc change so the caller can persist moved and orphaned anchors. */
    onAnchorsMapped?: (updates: Array<{ id: string; anchor: ContentAnchor | null }>) => void;
    onActivate?: (id: string) => void;
}

interface HighlightState {
    items: AnchoredItem[];
    activeId: string | null;
    decorations: DecorationSet;
}

export const commentHighlightKey = new PluginKey<HighlightState>('approvalCommentHighlight');

/** Read the plain text of a range, so an anchor's repair kit matches what the user sees. */
export function anchorFromSelection(doc: PMNode, from: number, to: number): ContentAnchor {
    return {
        from,
        to,
        quotedText: doc.textBetween(from, to, ' '),
        prefix: doc.textBetween(Math.max(0, from - CONTEXT_CHARS), from, ' '),
        suffix: doc.textBetween(to, Math.min(doc.content.size, to + CONTEXT_CHARS), ' '),
    };
}

function buildDecorations(state: EditorState, items: AnchoredItem[], activeId: string | null): DecorationSet {
    const visible = items.filter((i) => !i.resolved);
    if (visible.length === 0) return DecorationSet.empty;

    const docSize = state.doc.content.size;
    const inBounds = visible.filter((i) => i.anchor.from >= 0 && i.anchor.to <= docSize && i.anchor.to > i.anchor.from);

    const segments = segmentHighlights(inBounds.map((i) => ({ id: i.id, anchor: i.anchor })));
    const byId = new Map(inBounds.map((i) => [i.id, i]));

    const decorations = segments.map((segment) => {
        const isActive = activeId !== null && segment.ids.includes(activeId);
        const hasSuggestion = segment.ids.some((id) => byId.get(id)?.kind === 'suggestion');
        // Depth drives tint intensity rather than painting opaque blocks, so overlapping
        // threads stay readable instead of hiding the text they refer to.
        const depth = Math.min(segment.ids.length, 3);

        return Decoration.inline(segment.from, segment.to, {
            class: [
                'approval-highlight',
                `approval-highlight--depth-${depth}`,
                hasSuggestion ? 'approval-highlight--suggestion' : '',
                isActive ? 'approval-highlight--active' : '',
            ].filter(Boolean).join(' '),
            'data-comment-ids': segment.ids.join(','),
        });
    });

    return DecorationSet.create(state.doc, decorations);
}

export const CommentHighlight = Extension.create<CommentHighlightOptions>({
    name: 'approvalCommentHighlight',

    addOptions() {
        return { items: [], activeId: null };
    },

    addProseMirrorPlugins() {
        // Captured once: the plugin closures need the options, and `this` inside the
        // Plugin literals is the plugin, not the extension.
        const options = this.options;

        return [
            new Plugin<HighlightState>({
                key: commentHighlightKey,

                state: {
                    init(_config, state) {
                        const { items, activeId } = options;
                        return { items, activeId, decorations: buildDecorations(state, items, activeId) };
                    },

                    apply(tr: Transaction, value: HighlightState, _old, newState): HighlightState {
                        const replacement = tr.getMeta(commentHighlightKey) as
                            | { items?: AnchoredItem[]; activeId?: string | null }
                            | undefined;

                        if (replacement) {
                            const items = replacement.items ?? value.items;
                            const activeId = replacement.activeId !== undefined ? replacement.activeId : value.activeId;
                            return { items, activeId, decorations: buildDecorations(newState, items, activeId) };
                        }

                        if (!tr.docChanged) return value;

                        // Both assoc biases point INWARD so text typed at either boundary
                        // lands outside the highlight. A collapsed range means the
                        // anchored text was deleted — the item orphans, it is never lost.
                        const items: AnchoredItem[] = [];
                        for (const item of value.items) {
                            const from = tr.mapping.map(item.anchor.from, 1);
                            const to = tr.mapping.map(item.anchor.to, -1);
                            if (to <= from) continue;
                            items.push({ ...item, anchor: { ...item.anchor, from, to } });
                        }

                        return { items, activeId: value.activeId, decorations: buildDecorations(newState, items, value.activeId) };
                    },
                },

                props: {
                    decorations(state) {
                        return commentHighlightKey.getState(state)?.decorations ?? DecorationSet.empty;
                    },

                    handleClick(view, pos) {
                        const state = commentHighlightKey.getState(view.state);
                        if (!state || !options.onActivate) return false;

                        // Innermost wins: clicking inside a nested highlight should open
                        // the specific thread, not the paragraph-wide one around it.
                        const covering = state.items
                            .filter((i) => !i.resolved && i.anchor.from <= pos && i.anchor.to >= pos)
                            .sort((a, b) => (a.anchor.to - a.anchor.from) - (b.anchor.to - b.anchor.from));

                        if (covering.length === 0) return false;
                        options.onActivate(covering[0].id);
                        return false;
                    },
                },

                view() {
                    let previous: AnchoredItem[] = options.items;
                    return {
                        update(view) {
                            const next = commentHighlightKey.getState(view.state)?.items ?? [];
                            if (next === previous) return;

                            const handler = options.onAnchorsMapped;
                            if (handler) {
                                const updates: Array<{ id: string; anchor: ContentAnchor | null }> = [];
                                const nextById = new Map(next.map((i) => [i.id, i]));

                                for (const before of previous) {
                                    const after = nextById.get(before.id);
                                    if (!after) {
                                        updates.push({ id: before.id, anchor: null });
                                    } else if (
                                        after.anchor.from !== before.anchor.from ||
                                        after.anchor.to !== before.anchor.to
                                    ) {
                                        updates.push({ id: before.id, anchor: after.anchor });
                                    }
                                }

                                if (updates.length > 0) handler(updates);
                            }

                            previous = next;
                        },
                    };
                },
            }),
        ];
    },
});

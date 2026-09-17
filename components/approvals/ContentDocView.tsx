'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { MessageSquarePlus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { approvalEditorExtensions } from '@/lib/approvals/editor-extensions';
import {
    anchorFromSelection,
    CommentHighlight,
    commentHighlightKey,
    type AnchoredItem,
} from '@/lib/approvals/comment-highlight';
import type { ContentAnchor } from '@/lib/types';

interface ContentDocViewProps {
    content: Record<string, unknown>;
    /**
     * Read-only for the client reader, and for the internal editor whenever the document
     * is locked for review — a document is either open for review or open for editing,
     * never both.
     */
    editable: boolean;
    items: AnchoredItem[];
    activeId: string | null;
    onActivate: (id: string) => void;
    /** Selection -> new thread. Omit to disable commenting entirely (view-only links). */
    onRequestComment?: (anchor: ContentAnchor) => void;
    onAnchorsMapped?: (updates: Array<{ id: string; anchor: ContentAnchor | null }>) => void;
    onChange?: (json: Record<string, unknown>) => void;
    className?: string;
}

interface FloatingButton {
    top: number;
    left: number;
    anchor: ContentAnchor;
}

export function ContentDocView({
    content,
    editable,
    items,
    activeId,
    onActivate,
    onRequestComment,
    onAnchorsMapped,
    onChange,
    className,
}: ContentDocViewProps) {
    const [floating, setFloating] = useState<FloatingButton | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Handlers live in a ref so the editor is created once. Recreating it on every render
    // would lose selection, scroll position, and the mapped anchor state.
    const handlers = useRef({ onActivate, onAnchorsMapped, onChange });
    useEffect(() => {
        handlers.current = { onActivate, onAnchorsMapped, onChange };
    }, [onActivate, onAnchorsMapped, onChange]);

    const extensions = useMemo(
        () => [
            ...approvalEditorExtensions(),
            CommentHighlight.configure({
                items,
                activeId,
                onActivate: (id) => handlers.current.onActivate(id),
                onAnchorsMapped: (updates) => handlers.current.onAnchorsMapped?.(updates),
            }),
        ],
        // Intentionally built once — live updates flow through the plugin's meta channel.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );

    const editor = useEditor({
        extensions,
        content,
        editable,
        // Next SSR: rendering immediately causes a hydration mismatch.
        immediatelyRender: false,
        onUpdate: ({ editor: instance }) => {
            handlers.current.onChange?.(instance.getJSON() as Record<string, unknown>);
        },
    });

    useEffect(() => {
        editor?.setEditable(editable);
    }, [editor, editable]);

    // Push item/active changes through the plugin rather than rebuilding the editor.
    useEffect(() => {
        if (!editor) return;
        const { tr } = editor.state;
        tr.setMeta(commentHighlightKey, { items, activeId });
        editor.view.dispatch(tr);
    }, [editor, items, activeId]);

    // Replace content only when a genuinely different document arrives (e.g. switching
    // documents in a batch), never on our own edits.
    const contentKey = useMemo(() => JSON.stringify(content).length, [content]);
    const lastContentKey = useRef(contentKey);
    useEffect(() => {
        if (!editor || contentKey === lastContentKey.current) return;
        lastContentKey.current = contentKey;
        editor.commands.setContent(content, { emitUpdate: false });
    }, [editor, content, contentKey]);

    const updateFloating = useCallback(() => {
        if (!editor || !onRequestComment) return setFloating(null);

        const { from, to, empty } = editor.state.selection;
        if (empty || to - from < 1) return setFloating(null);

        const container = containerRef.current;
        if (!container) return setFloating(null);

        const start = editor.view.coordsAtPos(from);
        const box = container.getBoundingClientRect();
        setFloating({
            top: start.top - box.top + container.scrollTop - 40,
            left: Math.max(0, start.left - box.left),
            anchor: anchorFromSelection(editor.state.doc, from, to),
        });
    }, [editor, onRequestComment]);

    useEffect(() => {
        if (!editor) return;
        editor.on('selectionUpdate', updateFloating);
        return () => {
            editor.off('selectionUpdate', updateFloating);
        };
    }, [editor, updateFloating]);

    if (!editor) {
        return <div className={cn('approval-doc animate-pulse text-muted-foreground', className)}>Loading document…</div>;
    }

    return (
        <div ref={containerRef} className={cn('approval-doc relative', className)}>
            <EditorContent editor={editor} />

            {floating && onRequestComment && (
                <button
                    type="button"
                    style={{ top: floating.top, left: floating.left }}
                    className="absolute z-20 flex items-center gap-1.5 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs font-medium shadow-md hover:bg-accent hover:text-accent-foreground"
                    // mousedown would collapse the selection before the click lands.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                        onRequestComment(floating.anchor);
                        setFloating(null);
                    }}
                >
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                    Comment
                </button>
            )}
        </div>
    );
}

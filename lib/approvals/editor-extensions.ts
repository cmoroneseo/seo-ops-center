import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import type { Extensions } from '@tiptap/react';

/**
 * The node and mark set the approval portal renders.
 *
 * Shared deliberately between the internal editor and the client-facing reader — a
 * reviewer must see exactly what the writer sees, so a single list means the two can
 * never drift into rendering different documents.
 *
 * Underline ships inside StarterKit v3; Subscript/Superscript and tables do not.
 */
export function approvalEditorExtensions(): Extensions {
    return [
        StarterKit.configure({
            // Headings run H1–H6. The original brief said H1–H3, which would flatten
            // every H4 in real imported content.
            heading: { levels: [1, 2, 3, 4, 5, 6] },
            link: false, // configured separately below
        }),
        Link.configure({
            // `openOnClick: false` only disables Tiptap's own handler — the rendered <a>
            // is still a real link, so without target="_blank" a reviewer who clicks one
            // navigates away from the document they were reviewing and loses the page.
            openOnClick: false,
            autolink: false,
            HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        }),
        Subscript,
        Superscript,
        Image.configure({
            // Alt text is an SEO requirement, so it must survive a render round-trip.
            HTMLAttributes: { loading: 'lazy' },
        }),
        TableKit.configure({
            table: { resizable: true, HTMLAttributes: { class: 'approval-table' } },
        }),
    ];
}

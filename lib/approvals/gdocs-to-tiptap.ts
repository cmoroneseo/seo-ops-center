/**
 * Google Docs API JSON → Tiptap/ProseMirror JSON.
 *
 * Runs ONCE per document, at the handoff to client review. After that the app owns the
 * content, so anything this gets slightly wrong is fixed by hand in the editor minutes
 * later — which is why fidelity here is worth paying for but perfection is not.
 *
 * Pure: no IO. Image bytes are re-hosted by the caller, which passes `resolveImage` to
 * substitute the durable URL (Google's `contentUri` is short-lived and would rot).
 */

// ─── Minimal Docs API shapes ────────────────────────────────────────────────

export interface GDocTextStyle {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    baselineOffset?: 'BASELINE_OFFSET_UNSPECIFIED' | 'NONE' | 'SUPERSCRIPT' | 'SUBSCRIPT';
    link?: { url?: string };
}

export interface GDocParagraphElement {
    textRun?: { content?: string; textStyle?: GDocTextStyle };
    inlineObjectElement?: { inlineObjectId?: string };
    horizontalRule?: Record<string, unknown>;
    pageBreak?: Record<string, unknown>;
}

export interface GDocParagraph {
    elements?: GDocParagraphElement[];
    paragraphStyle?: { namedStyleType?: string; headingId?: string };
    bullet?: { listId?: string; nestingLevel?: number };
}

export interface GDocStructuralElement {
    paragraph?: GDocParagraph;
    table?: GDocTable;
    sectionBreak?: Record<string, unknown>;
    tableOfContents?: Record<string, unknown>;
}

export interface GDocTable {
    tableRows?: Array<{ tableCells?: Array<{ content?: GDocStructuralElement[] }> }>;
}

export interface GDocList {
    listProperties?: {
        nestingLevels?: Array<{ glyphType?: string; glyphSymbol?: string }>;
    };
}

export interface GDocInlineObject {
    inlineObjectProperties?: {
        embeddedObject?: {
            imageProperties?: { contentUri?: string };
            title?: string;
            description?: string;
        };
    };
}

export interface GoogleDoc {
    documentId?: string;
    revisionId?: string;
    title?: string;
    body?: { content?: GDocStructuralElement[] };
    lists?: Record<string, GDocList>;
    inlineObjects?: Record<string, GDocInlineObject>;
}

// ─── Tiptap output shapes ───────────────────────────────────────────────────

export interface TiptapMark {
    type: string;
    attrs?: Record<string, unknown>;
}

export interface TiptapNode {
    type: string;
    attrs?: Record<string, unknown>;
    content?: TiptapNode[];
    marks?: TiptapMark[];
    text?: string;
}

export interface ConvertOptions {
    /**
     * Maps a Google inline-object id and its short-lived `contentUri` to a durable URL.
     * Returning null drops the image rather than emitting a link that will rot.
     */
    resolveImage?: (objectId: string, contentUri: string | undefined) => string | null;
}

export interface ConvertResult {
    doc: TiptapNode;
    wordCount: number;
    /** Inline-object ids encountered, so the caller knows what to re-host. */
    imageObjectIds: string[];
    warnings: string[];
}

const HEADING_LEVELS: Record<string, number> = {
    HEADING_1: 1,
    HEADING_2: 2,
    HEADING_3: 3,
    HEADING_4: 4,
    HEADING_5: 5,
    HEADING_6: 6,
};

// ─── Pending-suggestion guard ───────────────────────────────────────────────

/**
 * `documents.get` defaults to SUGGESTIONS_INLINE, which folds pending, un-accepted Google
 * Docs suggestions into the text. Importing that would send the client content nobody
 * approved. Callers must pass `suggestionsViewMode` explicitly AND refuse the import when
 * this returns true.
 */
export function hasPendingSuggestions(value: unknown): boolean {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(hasPendingSuggestions);

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (
            (key === 'suggestedInsertionIds' || key === 'suggestedDeletionIds') &&
            Array.isArray(child) &&
            child.length > 0
        ) {
            return true;
        }
        if (key.startsWith('suggested') && child && typeof child === 'object') {
            if (Array.isArray(child) ? child.length > 0 : Object.keys(child).length > 0) {
                return true;
            }
        }
        if (hasPendingSuggestions(child)) return true;
    }
    return false;
}

// ─── Inline conversion ──────────────────────────────────────────────────────

function marksFor(style: GDocTextStyle | undefined): TiptapMark[] {
    if (!style) return [];
    const marks: TiptapMark[] = [];
    if (style.bold) marks.push({ type: 'bold' });
    if (style.italic) marks.push({ type: 'italic' });
    if (style.underline) marks.push({ type: 'underline' });
    if (style.strikethrough) marks.push({ type: 'strike' });
    if (style.baselineOffset === 'SUPERSCRIPT') marks.push({ type: 'superscript' });
    if (style.baselineOffset === 'SUBSCRIPT') marks.push({ type: 'subscript' });
    if (style.link?.url) marks.push({ type: 'link', attrs: { href: style.link.url } });
    return marks;
}

function inlineContent(
    paragraph: GDocParagraph,
    doc: GoogleDoc,
    opts: ConvertOptions,
    result: { imageObjectIds: string[]; warnings: string[] },
): TiptapNode[] {
    const out: TiptapNode[] = [];

    for (const el of paragraph.elements ?? []) {
        if (el.textRun) {
            // Google terminates every paragraph with a newline; it is structure, not text.
            const text = (el.textRun.content ?? '').replace(/\n$/, '');
            if (text.length === 0) continue;
            const marks = marksFor(el.textRun.textStyle);
            out.push(marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text });
            continue;
        }

        if (el.inlineObjectElement?.inlineObjectId) {
            const objectId = el.inlineObjectElement.inlineObjectId;
            result.imageObjectIds.push(objectId);
            const embedded = doc.inlineObjects?.[objectId]?.inlineObjectProperties?.embeddedObject;
            const contentUri = embedded?.imageProperties?.contentUri;
            const src = opts.resolveImage
                ? opts.resolveImage(objectId, contentUri)
                : (contentUri ?? null);
            if (!src) {
                result.warnings.push(`Image ${objectId} could not be resolved and was dropped.`);
                continue;
            }
            out.push({
                type: 'image',
                attrs: {
                    src,
                    // Alt text is an SEO requirement, not decoration — carry it through.
                    alt: embedded?.description ?? '',
                    title: embedded?.title ?? null,
                },
            });
        }
    }

    return out;
}

function blockFor(paragraph: GDocParagraph, content: TiptapNode[]): TiptapNode {
    const named = paragraph.paragraphStyle?.namedStyleType ?? 'NORMAL_TEXT';
    const level = HEADING_LEVELS[named];

    if (level) {
        return {
            type: 'heading',
            attrs: {
                level,
                // Google's heading ids survive editing in Docs; keep them for traceability
                // back to the source document.
                headingId: paragraph.paragraphStyle?.headingId ?? null,
            },
            content,
        };
    }

    if (named === 'TITLE') {
        return { type: 'heading', attrs: { level: 1, headingId: null }, content };
    }
    if (named === 'SUBTITLE') {
        return { type: 'heading', attrs: { level: 2, headingId: null }, content };
    }

    return { type: 'paragraph', content };
}

// ─── Lists ──────────────────────────────────────────────────────────────────

/**
 * Google stores no list nodes. Each bulleted paragraph is a flat paragraph carrying
 * `bullet.listId` plus an OPTIONAL `nestingLevel` that is omitted entirely when 0.
 * Ordered-vs-bulleted is not on the paragraph either — it lives on the document's
 * `lists` map, per nesting level.
 */
export function isOrderedList(doc: GoogleDoc, listId: string, nestingLevel: number): boolean {
    const level = doc.lists?.[listId]?.listProperties?.nestingLevels?.[nestingLevel];
    if (!level) return false;
    // glyphType (DECIMAL, ALPHA, ROMAN…) means ordered; glyphSymbol (•, ○, ▪) means bulleted.
    return typeof level.glyphType === 'string' && level.glyphType.length > 0
        && level.glyphType !== 'GLYPH_TYPE_UNSPECIFIED';
}

interface ListEntry {
    nestingLevel: number;
    ordered: boolean;
    block: TiptapNode;
}

/** Fold a run of same-list paragraphs into a nested bulletList/orderedList tree. */
export function buildListTree(entries: ListEntry[]): TiptapNode | null {
    if (entries.length === 0) return null;

    const rootType = entries[0].ordered ? 'orderedList' : 'bulletList';
    const root: TiptapNode = { type: rootType, content: [] };
    // stack[i] is the list node holding items at nesting level i.
    const stack: TiptapNode[] = [root];

    for (const entry of entries) {
        const depth = Math.max(0, entry.nestingLevel);

        // Descend: open intermediate lists inside the last item of the level above.
        while (stack.length <= depth) {
            const parentList = stack[stack.length - 1];
            let host = parentList.content?.[(parentList.content?.length ?? 0) - 1];
            if (!host) {
                // A jump in nesting with no preceding item — synthesize one so the tree
                // stays valid rather than dropping the content.
                host = { type: 'listItem', content: [] };
                parentList.content = [...(parentList.content ?? []), host];
            }
            const nested: TiptapNode = {
                type: entry.ordered ? 'orderedList' : 'bulletList',
                content: [],
            };
            host.content = [...(host.content ?? []), nested];
            stack.push(nested);
        }

        // Ascend back out of deeper levels.
        while (stack.length > depth + 1) stack.pop();

        const list = stack[stack.length - 1];
        list.content = [...(list.content ?? []), { type: 'listItem', content: [entry.block] }];
    }

    return root;
}

// ─── Tables ─────────────────────────────────────────────────────────────────

function convertTable(
    table: GDocTable,
    doc: GoogleDoc,
    opts: ConvertOptions,
    result: { imageObjectIds: string[]; warnings: string[] },
): TiptapNode {
    const rows = (table.tableRows ?? []).map((row, rowIndex) => ({
        type: 'tableRow',
        content: (row.tableCells ?? []).map((cell) => {
            const cellContent = convertElements(cell.content ?? [], doc, opts, result);
            return {
                // Row 0 is a header row — the fixture's comparison table relies on this.
                type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: cellContent.length > 0 ? cellContent : [{ type: 'paragraph' }],
            };
        }),
    }));

    return { type: 'table', content: rows };
}

// ─── Main walk ──────────────────────────────────────────────────────────────

function convertElements(
    elements: GDocStructuralElement[],
    doc: GoogleDoc,
    opts: ConvertOptions,
    result: { imageObjectIds: string[]; warnings: string[] },
): TiptapNode[] {
    const out: TiptapNode[] = [];
    let listRun: { listId: string; entries: ListEntry[] } | null = null;

    const flushList = () => {
        if (!listRun) return;
        const tree = buildListTree(listRun.entries);
        if (tree) out.push(tree);
        listRun = null;
    };

    for (const el of elements) {
        if (el.table) {
            flushList();
            out.push(convertTable(el.table, doc, opts, result));
            continue;
        }

        if (!el.paragraph) {
            // sectionBreak / tableOfContents carry no content worth importing.
            continue;
        }

        const paragraph = el.paragraph;

        // A horizontal rule arrives as its own paragraph element.
        const hasRule = (paragraph.elements ?? []).some((e) => e.horizontalRule);
        if (hasRule) {
            flushList();
            out.push({ type: 'horizontalRule' });
            continue;
        }

        const content = inlineContent(paragraph, doc, opts, result);

        if (paragraph.bullet?.listId) {
            const listId = paragraph.bullet.listId;
            const nestingLevel = paragraph.bullet.nestingLevel ?? 0;
            const ordered = isOrderedList(doc, listId, nestingLevel);
            const block: TiptapNode = { type: 'paragraph', content };

            if (listRun && listRun.listId !== listId) flushList();
            if (!listRun) listRun = { listId, entries: [] };
            listRun.entries.push({ nestingLevel, ordered, block });
            continue;
        }

        flushList();

        // Genuinely empty paragraphs are Google's spacing, not content.
        if (content.length === 0) continue;
        out.push(blockFor(paragraph, content));
    }

    flushList();
    return out;
}

export function countWords(node: TiptapNode): number {
    if (node.type === 'text') {
        const words = (node.text ?? '').trim().split(/\s+/).filter(Boolean);
        return words.length;
    }
    return (node.content ?? []).reduce((sum, child) => sum + countWords(child), 0);
}

export function convertGoogleDoc(doc: GoogleDoc, opts: ConvertOptions = {}): ConvertResult {
    const result = { imageObjectIds: [] as string[], warnings: [] as string[] };
    const content = convertElements(doc.body?.content ?? [], doc, opts, result);

    const tiptapDoc: TiptapNode = {
        type: 'doc',
        content: content.length > 0 ? content : [{ type: 'paragraph' }],
    };

    return {
        doc: tiptapDoc,
        wordCount: countWords(tiptapDoc),
        imageObjectIds: result.imageObjectIds,
        warnings: result.warnings,
    };
}

/** Accepts a full Docs URL or a bare id. */
export function extractDocumentId(input: string): string | null {
    const trimmed = input.trim();
    const match = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
    return null;
}

/**
 * Validation for the batch name.
 *
 * A batch name is **client-facing** — it is the heading at the top of the review portal.
 * The first real user pasted a Google Doc URL into this field (the import field is the
 * one that wants a URL, but a fresh clipboard and a text input are a strong pull), which
 * would have shown the client an internal Drive link as the title of their review.
 */

export type BatchNameIssue = 'empty' | 'document_link' | 'url' | null;

const GOOGLE_DOC = /docs\.google\.com\/document\//i;
const ANY_URL = /^(https?:\/\/|www\.)/i;

export function batchNameIssue(raw: string): BatchNameIssue {
    const name = raw.trim();
    if (!name) return 'empty';
    if (GOOGLE_DOC.test(name)) return 'document_link';
    if (ANY_URL.test(name)) return 'url';
    return null;
}

export function batchNameHint(issue: BatchNameIssue): string | null {
    switch (issue) {
        case 'document_link':
            return 'That is a document link. Name the batch for the package the client sees — “October Content” — then paste the link into Import below.';
        case 'url':
            return 'The batch name is shown to the client at the top of their review. Give it a name rather than a link.';
        default:
            return null;
    }
}

/** Can this name be used? Empty is blocked by the disabled button, not by a message. */
export function canUseBatchName(raw: string): boolean {
    return batchNameIssue(raw) === null;
}

/**
 * Validation for the batch name.
 *
 * A batch name is **client-facing** — it is the heading at the top of the review portal.
 * The first real user pasted a Google Doc URL into this field (the import field is the
 * one that wants a URL, but a fresh clipboard and a text input are a strong pull), which
 * would have shown the client an internal Drive link as the title of their review.
 */

export type BatchNameIssue = 'empty' | 'document_link' | 'url' | null;

const ANY_URL = /^(https?:\/\/|www\.)/i;

/**
 * Is this string a Google Docs URL?
 *
 * Parsed as a URL and compared on the hostname rather than pattern-matched. An
 * unanchored regex like /docs\.google\.com\/document\// also matches
 * `https://evil.com/?x=docs.google.com/document/`, because the host can be anywhere in
 * the string — CodeQL flags exactly that (js/regex/missing-regexp-anchor). It is only a
 * naming guard here rather than a trust decision, but the pattern is wrong either way
 * and would be dangerous the moment someone reused it for one.
 */
function isGoogleDocUrl(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed || /\s/.test(trimmed)) return false;

    // A pasted link often arrives without a protocol.
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

    let url: URL;
    try {
        url = new URL(candidate);
    } catch {
        return false;
    }

    const host = url.hostname.toLowerCase();
    const isDocsHost = host === 'docs.google.com' || host.endsWith('.docs.google.com');
    return isDocsHost && url.pathname.startsWith('/document/');
}

export function batchNameIssue(raw: string): BatchNameIssue {
    const name = raw.trim();
    if (!name) return 'empty';
    if (isGoogleDocUrl(name)) return 'document_link';
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

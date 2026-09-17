import { hasPendingSuggestions, type GoogleDoc } from '../approvals/gdocs-to-tiptap';
import { DOCS_SCOPES, getAccessToken, type ServiceAccountCredentials } from './service-account';

/**
 * Google Docs REST reads.
 *
 * `suggestionsViewMode` is ALWAYS passed explicitly. The API default folds pending,
 * un-accepted Google Docs suggestions into the text — importing that would send a client
 * content nobody approved.
 *
 * We request PREVIEW_WITHOUT_SUGGESTIONS, which is the only mode that both excludes
 * suggested text AND works with read-only access. SUGGESTIONS_INLINE and
 * PREVIEW_SUGGESTIONS_ACCEPTED both require commenter or editor rights — verified live: a
 * service account with Viewer gets `403 You do not have permission to access the document
 * suggestions`. Requesting those would force us to hold write access on every client
 * document just to read it, which is not a trade worth making.
 */
export const IMPORT_SUGGESTIONS_VIEW_MODE = 'PREVIEW_WITHOUT_SUGGESTIONS';

/** The mode that exposes suggestion metadata — needs more than read access. */
const SUGGESTION_PROBE_VIEW_MODE = 'SUGGESTIONS_INLINE';

const DOCS_ENDPOINT = 'https://docs.googleapis.com/v1/documents';

export class GoogleDocsError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly hint?: string,
    ) {
        super(message);
        this.name = 'GoogleDocsError';
    }
}

/** The shape Google returns on failure. Only the parts we branch on. */
export interface DocsErrorBody {
    error?: {
        status?: string;
        message?: string;
        details?: Array<{ '@type'?: string; reason?: string }>;
    };
}

/**
 * Turn Google's status codes into something a user can act on.
 *
 * A 403 is genuinely ambiguous and the two causes have nothing to do with each other:
 * the Docs API not being enabled on the project, versus the document not being shared
 * with the service account. Both arrive as PERMISSION_DENIED. Telling someone to share a
 * document when the real problem is a disabled API sends them down a dead end — verified
 * live against a fresh project, which is exactly how this was found.
 */
export function describeDocsFailure(
    status: number,
    documentId: string,
    body?: DocsErrorBody,
): { message: string; hint: string } {
    const reasons = (body?.error?.details ?? []).map((d) => d.reason).filter(Boolean);
    const serviceDisabled = reasons.includes('SERVICE_DISABLED')
        || /has not been used in project|is disabled/i.test(body?.error?.message ?? '');

    if (serviceDisabled) {
        return {
            message: 'The Google Docs API is not enabled on this Google Cloud project.',
            hint: 'Enable the Google Docs API (and the Google Drive API) in the project that owns the service account, then wait a minute and retry.',
        };
    }

    if (status === 404) {
        return {
            message: `Google Doc ${documentId} was not found.`,
            hint: 'Check the link, and make sure the document has not been deleted.',
        };
    }
    if (status === 403) {
        return {
            message: `Access denied to Google Doc ${documentId}.`,
            hint: 'Share the document (or its parent Drive folder) with the service account email. For a Shared Drive, add the service account as a member.',
        };
    }
    if (status === 401) {
        return {
            message: 'Google rejected the service-account credentials.',
            hint: 'Check GOOGLE_SERVICE_ACCOUNT_JSON — a key pasted into an env var needs its \\n escapes intact.',
        };
    }
    if (status === 429) {
        return { message: 'Google Docs API rate limit hit.', hint: 'Wait a moment and retry the import.' };
    }
    return { message: `Google Docs API returned ${status}.`, hint: 'Retry; if it persists, check the Google Cloud project quota.' };
}

export async function fetchGoogleDoc(
    credentials: ServiceAccountCredentials,
    documentId: string,
): Promise<GoogleDoc> {
    const token = await getAccessToken(credentials, DOCS_SCOPES);
    const url = `${DOCS_ENDPOINT}/${encodeURIComponent(documentId)}?suggestionsViewMode=${IMPORT_SUGGESTIONS_VIEW_MODE}`;

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (!response.ok) {
        const body = (await response.json().catch(() => undefined)) as DocsErrorBody | undefined;
        const { message, hint } = describeDocsFailure(response.status, documentId, body);
        throw new GoogleDocsError(message, response.status, hint);
    }

    return (await response.json()) as GoogleDoc;
}

/**
 * Can we see that the document has un-accepted suggestions in it?
 *
 * Returns true/false when we could check, and **null when we could not** — a read-only
 * grant cannot see suggestions at all. Null is not a failure: the imported content came
 * from PREVIEW_WITHOUT_SUGGESTIONS, so suggested text was already excluded. What we lose
 * is only the ability to warn that the writer left suggestions unresolved.
 */
export async function probePendingSuggestions(
    credentials: ServiceAccountCredentials,
    documentId: string,
): Promise<boolean | null> {
    const token = await getAccessToken(credentials, DOCS_SCOPES);
    const url = `${DOCS_ENDPOINT}/${encodeURIComponent(documentId)}?suggestionsViewMode=${SUGGESTION_PROBE_VIEW_MODE}`;

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 403) return null; // read-only access — cannot see suggestions
    if (!response.ok) return null;

    const doc = await response.json().catch(() => null);
    return doc ? hasPendingSuggestions(doc) : null;
}

/**
 * Read just the revisionId, for the daily drift guard.
 *
 * The Doc is archival after handoff, so a changed revisionId means someone edited the
 * source after the one-way door closed — their changes are NOT in the portal.
 */
export async function fetchRevisionId(
    credentials: ServiceAccountCredentials,
    documentId: string,
): Promise<string | null> {
    const token = await getAccessToken(credentials, DOCS_SCOPES);
    const url = `${DOCS_ENDPOINT}/${encodeURIComponent(documentId)}?fields=revisionId`;

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;

    const body = (await response.json()) as { revisionId?: string };
    return body.revisionId ?? null;
}

/**
 * Download an embedded image.
 *
 * Google's `contentUri` is short-lived — a portal that linked to it directly would show
 * the client broken images within days, so every image is re-hosted at import.
 */
export async function fetchImageBytes(
    credentials: ServiceAccountCredentials,
    contentUri: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
    const token = await getAccessToken(credentials, DOCS_SCOPES);
    const response = await fetch(contentUri, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;

    return {
        bytes: await response.arrayBuffer(),
        contentType: response.headers.get('content-type') ?? 'image/png',
    };
}

const EXTENSIONS: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
};

export function extensionForContentType(contentType: string): string {
    return EXTENSIONS[contentType.split(';')[0].trim().toLowerCase()] ?? 'png';
}

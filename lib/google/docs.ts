import type { GoogleDoc } from '../approvals/gdocs-to-tiptap';
import { DOCS_SCOPES, getAccessToken, type ServiceAccountCredentials } from './service-account';

/**
 * Google Docs REST reads.
 *
 * `suggestionsViewMode` is ALWAYS passed explicitly. The API default is
 * SUGGESTIONS_INLINE, which folds pending, un-accepted Google Docs suggestions into the
 * text — importing that would send a client content nobody approved.
 *
 * We deliberately request SUGGESTIONS_INLINE rather than PREVIEW_WITHOUT_SUGGESTIONS, and
 * then refuse the import when suggestions are present. One call does both jobs: if the
 * document has no pending suggestions the two modes return identical content, and if it
 * does, we want to stop rather than silently pick a side.
 */
export const IMPORT_SUGGESTIONS_VIEW_MODE = 'SUGGESTIONS_INLINE';

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

/** Turn Google's status codes into something a user can act on. */
export function describeDocsFailure(status: number, documentId: string): { message: string; hint: string } {
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
        const { message, hint } = describeDocsFailure(response.status, documentId);
        throw new GoogleDocsError(message, response.status, hint);
    }

    return (await response.json()) as GoogleDoc;
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

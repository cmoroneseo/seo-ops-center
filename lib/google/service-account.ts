import { createSign } from 'node:crypto';

/**
 * Google service-account auth, hand-rolled.
 *
 * The full `googleapis` package is ~50MB for two REST calls. The service-account flow is
 * a signed JWT exchanged for an access token (RFC 7523) — about forty lines, no
 * dependency, and the assembly half is pure enough to test.
 *
 * Setup: share the team's Drive content folder with the service account's email once.
 * Every doc inside inherits access, so there is no OAuth consent screen and no per-user
 * token refresh. For a Shared Drive, add the service account as a member of the drive.
 */

export interface ServiceAccountCredentials {
    clientEmail: string;
    privateKey: string;
    tokenUri: string;
}

export const DOCS_SCOPES = [
    'https://www.googleapis.com/auth/documents.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

/**
 * Parse the credentials JSON from an env var.
 *
 * Vercel env vars cannot hold real newlines, so a pasted service-account key arrives with
 * its PEM newlines escaped as the two characters `\` `n`. Unescaping them is not optional
 * — `createSign` rejects the key otherwise, with an error that says nothing useful.
 */
export function parseServiceAccount(raw: string | undefined): ServiceAccountCredentials | null {
    if (!raw || raw.trim() === '') return null;

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }

    const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email : '';
    const rawKey = typeof parsed.private_key === 'string' ? parsed.private_key : '';
    if (!clientEmail || !rawKey) return null;

    const privateKey = rawKey.replace(/\\n/g, '\n');
    if (!privateKey.includes('BEGIN') || !privateKey.includes('PRIVATE KEY')) return null;

    return {
        clientEmail,
        privateKey,
        tokenUri: typeof parsed.token_uri === 'string' ? parsed.token_uri : DEFAULT_TOKEN_URI,
    };
}

function base64url(input: Buffer | string): string {
    return Buffer.from(input).toString('base64url');
}

export interface JwtParts {
    /** The signing input — `header.claims`, before the signature is appended. */
    signingInput: string;
    header: Record<string, unknown>;
    claims: Record<string, unknown>;
}

/** Pure JWT assembly, split out from signing so the claim shape is testable. */
export function buildJwtParts(
    credentials: Pick<ServiceAccountCredentials, 'clientEmail' | 'tokenUri'>,
    scope: string,
    now: Date = new Date(),
    ttlSeconds = 3600,
): JwtParts {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
        iss: credentials.clientEmail,
        scope,
        aud: credentials.tokenUri,
        iat: issuedAt,
        exp: issuedAt + ttlSeconds,
    };
    return {
        signingInput: `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`,
        header,
        claims,
    };
}

export function signJwt(credentials: ServiceAccountCredentials, scope: string, now = new Date()): string {
    const { signingInput } = buildJwtParts(credentials, scope, now);
    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    return `${signingInput}.${signer.sign(credentials.privateKey, 'base64url')}`;
}

// ─── Access token, cached ───────────────────────────────────────────────────

interface CachedToken {
    token: string;
    expiresAt: number;
}

let cache: CachedToken | null = null;

/** Refresh a minute early so a token never expires mid-request. */
const EXPIRY_SKEW_MS = 60_000;

export function isCacheValid(cached: CachedToken | null, now = Date.now()): boolean {
    return cached !== null && cached.expiresAt - EXPIRY_SKEW_MS > now;
}

export function resetTokenCache(): void {
    cache = null;
}

export async function getAccessToken(
    credentials: ServiceAccountCredentials,
    scope: string = DOCS_SCOPES,
): Promise<string> {
    if (isCacheValid(cache)) return cache!.token;

    const assertion = signJwt(credentials, scope);
    const response = await fetch(credentials.tokenUri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion,
        }),
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(
            `Google token exchange failed (${response.status}). ${detail.slice(0, 200)}`,
        );
    }

    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('Google token exchange returned no access_token.');

    cache = {
        token: body.access_token,
        expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return cache.token;
}

export function loadServiceAccountFromEnv(): ServiceAccountCredentials | null {
    return parseServiceAccount(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

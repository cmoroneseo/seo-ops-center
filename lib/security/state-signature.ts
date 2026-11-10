import { createHmac } from 'node:crypto';

/**
 * Key for the Google connect state MAC.
 * `GOOGLE_OAUTH_STATE_SECRET` when set, otherwise the OAuth client secret.
 * The bytes are an HMAC key, not a password being stored.
 */
const SIGNING_KEY_NAMES = ['GOOGLE_OAUTH_STATE_SECRET', 'GOOGLE_CLIENT_SECRET'] as const;

export function readStateSigningKey(): string {
    const key = SIGNING_KEY_NAMES.map(name => process.env[name]).find((value): value is string => Boolean(value));
    if (!key) {
        throw new Error('Missing Google state signing key');
    }
    return key;
}

/** HMAC-SHA256 of the state payload, base64url. Matches states signed before this helper existed. */
export function signStatePayload(payload: string): string {
    return createHmac('sha256', readStateSigningKey()).update(payload).digest('base64url');
}

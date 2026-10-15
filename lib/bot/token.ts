import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Bot credentials.
 *
 * The plaintext token is shown once. The database stores a public prefix
 * (lookup key) and the SHA-256 of the whole token. Comparison is constant
 * time. A database leak does not yield a usable bearer.
 *
 * Shape: `socbot_<12 char prefix>_<43 char secret>`.
 */

const PREFIX_BYTES = 9;
const SECRET_BYTES = 32;
const TOKEN_RE = /^socbot_([A-Za-z0-9_-]{12})_([A-Za-z0-9_-]{43})$/;
const DUMMY_HASH = createHash('sha256').update('socbot-dummy', 'utf8').digest('hex');

export interface IssuedBotToken {
    token: string;
    prefix: string;
    hash: string;
}

export function generateBotToken(): IssuedBotToken {
    const prefix = randomBytes(PREFIX_BYTES).toString('base64url');
    const secret = randomBytes(SECRET_BYTES).toString('base64url');
    const token = `socbot_${prefix}_${secret}`;
    return { token, prefix, hash: hashBotToken(token) };
}

export function hashBotToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function parseBotToken(token: string): { prefix: string } | null {
    const match = TOKEN_RE.exec(token);
    if (!match) return null;
    return { prefix: match[1] };
}

export function readBearerToken(header: string | null | undefined): string | null {
    if (!header) return null;
    const match = /^Bearer\s+(\S+)$/.exec(header.trim());
    if (!match) return null;
    return match[1];
}

/** Constant-time check of a stored SHA-256 hex digest. */
export function botTokenMatches(token: string, storedHash: string): boolean {
    const candidate = createHash('sha256').update(token, 'utf8').digest();
    const stored = decodeHex(storedHash);
    if (!stored || stored.length !== candidate.length) {
        timingSafeEqual(candidate, candidate);
        return false;
    }
    return timingSafeEqual(candidate, stored);
}

/** Runs a compare even when the prefix was not found, so the miss path is not a fast reject. */
export function botTokenMatchesOrDummy(token: string, storedHash: string | null): boolean {
    return botTokenMatches(token, storedHash ?? DUMMY_HASH);
}

function decodeHex(value: string): Buffer | null {
    if (!/^[a-f0-9]{64}$/.test(value)) return null;
    return Buffer.from(value, 'hex');
}

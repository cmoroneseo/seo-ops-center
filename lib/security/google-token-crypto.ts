import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * App-level AES-256-GCM for Google OAuth tokens inside
 * `client_integrations.credentials`.
 *
 * Only `access_token` and `refresh_token` are sealed. Property ids, site
 * URLs, scopes, and the account email stay plaintext so existing JSON
 * queries keep working. A legacy string is still accepted on read.
 *
 * `GOOGLE_TOKEN_ENC_KEY` is either one 32-byte key (base64 or base64url),
 * kid `1`, or a comma-separated ring `kid:material,kid:material`. The first
 * pair is the key used for new writes unless `GOOGLE_TOKEN_ENC_KEY_ID`
 * names another kid in the ring. The key never goes in the database.
 */

export const GOOGLE_TOKEN_FIELDS = ['access_token', 'refresh_token'] as const;
export type GoogleTokenField = (typeof GOOGLE_TOKEN_FIELDS)[number];

export type GoogleTokenCryptoCode = 'key_invalid' | 'decrypt_failed';

export class GoogleTokenCryptoError extends Error {
    readonly code: GoogleTokenCryptoCode;

    constructor(code: GoogleTokenCryptoCode) {
        super(code === 'key_invalid' ? 'Google token encryption key is invalid' : 'Unable to decrypt Google token');
        this.name = 'GoogleTokenCryptoError';
        this.code = code;
    }
}

export interface TokenEnvelope {
    enc: 'aes-256-gcm';
    v: 1;
    kid: string;
    iv: string;
    tag: string;
    ct: string;
}

export interface KeyRing {
    currentKid: string;
    keys: ReadonlyMap<string, Buffer>;
}

export type SecretState = 'empty' | 'plaintext' | 'sealed' | 'rotate' | 'locked' | 'invalid';

const KID = /^[A-Za-z0-9_-]{1,32}$/;
const AAD_PREFIX = 'seo-ops.google-token.v1';

export function readKeyRing(source?: {
    GOOGLE_TOKEN_ENC_KEY?: string;
    GOOGLE_TOKEN_ENC_KEY_ID?: string;
}): KeyRing | null {
    const key = source ? source.GOOGLE_TOKEN_ENC_KEY : process.env.GOOGLE_TOKEN_ENC_KEY;
    const keyId = source ? source.GOOGLE_TOKEN_ENC_KEY_ID : process.env.GOOGLE_TOKEN_ENC_KEY_ID;
    const raw = key?.trim();
    if (!raw) return null;
    return parseKeyRing(raw, keyId?.trim() || undefined);
}

export function parseKeyRing(raw: string, currentId?: string): KeyRing {
    const keys = new Map<string, Buffer>();
    const parts = raw.split(',').map(part => part.trim()).filter(Boolean);
    if (parts.length === 0) throw new GoogleTokenCryptoError('key_invalid');

    if (parts.length === 1 && !parts[0].includes(':')) {
        keys.set('1', decodeKey(parts[0]));
    } else {
        for (const part of parts) {
            const split = part.indexOf(':');
            if (split <= 0) throw new GoogleTokenCryptoError('key_invalid');
            const kid = part.slice(0, split);
            if (!KID.test(kid) || keys.has(kid)) throw new GoogleTokenCryptoError('key_invalid');
            keys.set(kid, decodeKey(part.slice(split + 1)));
        }
    }

    const currentKid = currentId && currentId.length > 0 ? currentId : parts[0].includes(':') ? parts[0].slice(0, parts[0].indexOf(':')) : '1';
    if (!keys.has(currentKid)) throw new GoogleTokenCryptoError('key_invalid');
    return { currentKid, keys };
}

export function isTokenEnvelope(value: unknown): value is TokenEnvelope {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return row.enc === 'aes-256-gcm'
        && row.v === 1
        && typeof row.kid === 'string'
        && KID.test(row.kid)
        && typeof row.iv === 'string'
        && typeof row.tag === 'string'
        && typeof row.ct === 'string';
}

export function openCredentialSecrets(value: unknown, ring?: KeyRing | null): Record<string, unknown> {
    const resolved = ring === undefined ? readKeyRing() : ring;
    const source = plainObject(value);
    const next: Record<string, unknown> = { ...source };
    for (const field of GOOGLE_TOKEN_FIELDS) {
        if (!(field in next)) continue;
        next[field] = openTokenField(next[field], field, resolved);
    }
    return next;
}

export function sealCredentialSecrets(value: unknown, ring?: KeyRing | null): Record<string, unknown> {
    const resolved = ring === undefined ? readKeyRing() : ring;
    const source = plainObject(value);
    const next: Record<string, unknown> = { ...source };
    for (const field of GOOGLE_TOKEN_FIELDS) {
        if (!(field in next)) continue;
        next[field] = sealTokenField(next[field], field, resolved);
    }
    return next;
}

export function credentialSecretState(value: unknown, ring?: KeyRing | null): SecretState {
    const resolved = ring === undefined ? readKeyRing() : ring;
    const source = plainObject(value);
    let sawPlain = false;
    let sawCurrent = false;
    let sawOld = false;
    let sawLocked = false;
    let sawAny = false;

    for (const field of GOOGLE_TOKEN_FIELDS) {
        if (!(field in source)) continue;
        const token = source[field];
        if (token == null || token === '') continue;
        sawAny = true;
        if (typeof token === 'string') {
            sawPlain = true;
            continue;
        }
        if (!isTokenEnvelope(token)) return 'invalid';
        if (!resolved || !resolved.keys.has(token.kid)) {
            sawLocked = true;
            continue;
        }
        if (token.kid === resolved.currentKid) sawCurrent = true;
        else sawOld = true;
    }

    if (!sawAny) return 'empty';
    if (sawLocked) return 'locked';
    if (sawPlain) return 'plaintext';
    if (sawOld) return 'rotate';
    if (sawCurrent) return 'sealed';
    return 'invalid';
}

function openTokenField(value: unknown, field: GoogleTokenField, ring: KeyRing | null): unknown {
    if (value == null || value === '') return value;
    if (typeof value === 'string') return value;
    if (!isTokenEnvelope(value)) throw new GoogleTokenCryptoError('decrypt_failed');
    return decryptEnvelope(value, field, ring);
}

function sealTokenField(value: unknown, field: GoogleTokenField, ring: KeyRing | null): unknown {
    if (value == null || value === '') return value;
    if (typeof value === 'string') {
        if (!ring) return value;
        return encryptString(value, field, ring);
    }
    if (!isTokenEnvelope(value)) throw new GoogleTokenCryptoError('decrypt_failed');
    if (!ring) throw new GoogleTokenCryptoError('decrypt_failed');
    if (value.kid === ring.currentKid && ring.keys.has(value.kid)) return value;
    const plain = decryptEnvelope(value, field, ring);
    return encryptString(plain, field, ring);
}

function encryptString(plain: string, field: GoogleTokenField, ring: KeyRing): TokenEnvelope {
    const key = ring.keys.get(ring.currentKid);
    if (!key) throw new GoogleTokenCryptoError('key_invalid');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`${AAD_PREFIX}.${field}`, 'utf8'));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        enc: 'aes-256-gcm',
        v: 1,
        kid: ring.currentKid,
        iv: iv.toString('base64url'),
        tag: tag.toString('base64url'),
        ct: ct.toString('base64url'),
    };
}

function decryptEnvelope(envelope: TokenEnvelope, field: GoogleTokenField, ring: KeyRing | null): string {
    const key = ring?.keys.get(envelope.kid);
    if (!key) throw new GoogleTokenCryptoError('decrypt_failed');
    try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'));
        decipher.setAAD(Buffer.from(`${AAD_PREFIX}.${field}`, 'utf8'));
        decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
        const plain = Buffer.concat([
            decipher.update(Buffer.from(envelope.ct, 'base64url')),
            decipher.final(),
        ]).toString('utf8');
        if (plain.length === 0) throw new GoogleTokenCryptoError('decrypt_failed');
        return plain;
    } catch (error) {
        if (error instanceof GoogleTokenCryptoError) throw error;
        throw new GoogleTokenCryptoError('decrypt_failed');
    }
}

function decodeKey(material: string): Buffer {
    const trimmed = material.trim();
    if (!trimmed) throw new GoogleTokenCryptoError('key_invalid');
    const decoded = trimmed.includes('+') || trimmed.includes('/')
        ? Buffer.from(trimmed, 'base64')
        : Buffer.from(trimmed, 'base64url');
    if (decoded.length !== 32) throw new GoogleTokenCryptoError('key_invalid');
    return decoded;
}

function plainObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

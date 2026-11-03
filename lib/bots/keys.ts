import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { BOT_KEY_PREFIX } from './scope.ts';

export { BOT_KEY_PREFIX };

/** Every bot time entry and task is attributed to this user. */
export const BOT_ACTOR_EMAIL = 'cmorones@marketingempiregroup.com';

/**
 * Completion dates with no zone use the agency zone the rest of SEO Ops uses
 * for calendar days. A request may send its own IANA zone.
 */
export const BOT_ACTOR_TIME_ZONE = 'America/Los_Angeles';

export interface MintedBotKey {
    /** Shown once. Never stored and never logged. */
    token: string;
    prefix: string;
    hash: string;
}

export function hashBotKey(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export function generateBotKey(): MintedBotKey {
    const token = `${BOT_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    return {
        token,
        prefix: token.slice(0, 16),
        hash: hashBotKey(token),
    };
}

/** True when both hashes are SHA-256 hex and equal. */
export function botKeyHashMatches(storedHash: string, presentedToken: string): boolean {
    if (!/^[0-9a-f]{64}$/.test(storedHash)) return false;
    const presented = Buffer.from(hashBotKey(presentedToken), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    return presented.length === stored.length && timingSafeEqual(presented, stored);
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/;

/** Null when the name is empty, too long, or not a label a person can read. */
export function normalizeBotName(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const name = value.trim().replace(/\s+/g, ' ');
    if (!NAME.test(name)) return null;
    return name;
}

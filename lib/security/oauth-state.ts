import { createHmac, timingSafeEqual } from 'node:crypto';

type GoogleOAuthGroup = 'ga4-gsc' | 'gbp';

export type GoogleOAuthState = {
    clientId: string;
    orgId: string;
    group: GoogleOAuthGroup;
    exp: number;
};

const STATE_TTL_SECONDS = 10 * 60;

function getOAuthStateSecret() {
    const secret = process.env.GOOGLE_OAUTH_STATE_SECRET || process.env.GOOGLE_CLIENT_SECRET;
    if (!secret) {
        throw new Error('Missing Google OAuth state secret');
    }
    return secret;
}

function base64UrlEncode(value: string) {
    return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string) {
    return Buffer.from(value, 'base64url').toString('utf8');
}

function signPayload(payload: string) {
    return createHmac('sha256', getOAuthStateSecret()).update(payload).digest('base64url');
}

function isValidGroup(value: unknown): value is GoogleOAuthGroup {
    return value === 'ga4-gsc' || value === 'gbp';
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

export function createGoogleOAuthState(input: {
    clientId: string;
    orgId: string;
    group: GoogleOAuthGroup;
}) {
    const state: GoogleOAuthState = {
        clientId: input.clientId,
        orgId: input.orgId,
        group: input.group,
        exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
    };
    const payload = base64UrlEncode(JSON.stringify(state));
    const signature = signPayload(payload);
    return `${payload}.${signature}`;
}

export function verifyGoogleOAuthState(stateParam: string): GoogleOAuthState | null {
    const [payload, signature, extra] = stateParam.split('.');
    if (!payload || !signature || extra) {
        return null;
    }

    const expected = Buffer.from(signPayload(payload));
    const received = Buffer.from(signature);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(base64UrlDecode(payload));
    } catch {
        return null;
    }

    if (!parsed || typeof parsed !== 'object') {
        return null;
    }

    const record = parsed as Record<string, unknown>;
    if (!isNonEmptyString(record.clientId) || !isNonEmptyString(record.orgId) || !isValidGroup(record.group)) {
        return null;
    }

    if (typeof record.exp !== 'number' || record.exp < Math.floor(Date.now() / 1000)) {
        return null;
    }

    return {
        clientId: record.clientId,
        orgId: record.orgId,
        group: record.group,
        exp: record.exp,
    };
}

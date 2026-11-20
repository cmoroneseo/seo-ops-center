import type { createAdminClient } from '../supabase/admin.ts';
import { hashBotKey } from './keys.ts';
import { bearerToken, isBotKeyToken } from './scope.ts';

export interface BotKeyRecord {
    id: string;
    organizationId: string;
    name: string;
    revokedAt: string | null;
}

export async function verifyBotKey(
    token: string,
    admin: () => ReturnType<typeof createAdminClient>,
): Promise<BotKeyRecord | null> {
    const { data, error } = await admin()
        .from('bot_api_keys')
        .select('id, organization_id, name, revoked_at')
        .eq('key_hash', hashBotKey(token))
        .maybeSingle();
    if (error || !data || data.revoked_at) return null;
    return { id: data.id, organizationId: data.organization_id, name: data.name, revokedAt: null };
}

export async function authenticateBotRequest(
    request: Request,
    authenticate: (token: string) => Promise<BotKeyRecord | null>,
): Promise<{ key: BotKeyRecord } | { response: Response }> {
    const token = bearerToken(request.headers.get('authorization'));
    if (!token) {
        return { response: Response.json({
            error: 'Missing API key. Send Authorization: Bearer <key>.', code: 'missing_api_key',
        }, { status: 401 }) };
    }
    const key = isBotKeyToken(token) ? await authenticate(token) : null;
    if (!key || key.revokedAt) {
        return { response: Response.json({ error: 'Invalid API key.', code: 'invalid_api_key' }, { status: 401 }) };
    }
    return { key };
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrganizationAdmin } from '@/lib/security/tenant-authz';
import { generateBotKey, normalizeBotName } from '@/lib/bots/keys';
import { bearerToken, isBotKeyToken } from '@/lib/bots/scope';

export const dynamic = 'force-dynamic';

function denied(request: NextRequest) {
    const token = bearerToken(request.headers.get('authorization'));
    if (isBotKeyToken(token)) {
        return NextResponse.json(
            { error: 'This key cannot call that route.', code: 'forbidden' },
            { status: 403 },
        );
    }
    return null;
}

/** An owner mints a bot key. The plaintext is returned once. */
export async function POST(request: NextRequest) {
    const blocked = denied(request);
    if (blocked) return blocked;

    let body: { organizationId?: unknown; name?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Request body must be JSON.', code: 'invalid_json' }, { status: 400 });
    }

    const auth = await requireOrganizationAdmin(body.organizationId);
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: 'forbidden' }, { status: auth.status });

    const name = normalizeBotName(body.name);
    if (!name) {
        return NextResponse.json(
            { error: 'Name must be 1 to 40 characters.', code: 'invalid_request' },
            { status: 400 },
        );
    }

    const minted = generateBotKey();
    const { data, error } = await createAdminClient()
        .from('bot_api_keys')
        .insert({
            organization_id: auth.organizationId,
            name,
            key_prefix: minted.prefix,
            key_hash: minted.hash,
            created_by: auth.userId,
        })
        .select('id, name, key_prefix, created_at')
        .single();
    if (error) {
        const conflict = error.code === '23505';
        return NextResponse.json(
            {
                error: conflict ? 'A live key already uses that name.' : 'The key could not be created.',
                code: conflict ? 'duplicate_name' : 'internal',
            },
            { status: conflict ? 409 : 500 },
        );
    }

    return NextResponse.json({
        id: data.id,
        name: data.name,
        prefix: data.key_prefix,
        createdAt: data.created_at,
        token: minted.token,
    });
}

/** An owner revokes a bot key. The hash stays so old tokens cannot be reissued by accident. */
export async function DELETE(request: NextRequest) {
    const blocked = denied(request);
    if (blocked) return blocked;

    let body: { organizationId?: unknown; keyId?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Request body must be JSON.', code: 'invalid_json' }, { status: 400 });
    }

    const auth = await requireOrganizationAdmin(body.organizationId);
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: 'forbidden' }, { status: auth.status });
    if (typeof body.keyId !== 'string' || body.keyId.trim().length === 0) {
        return NextResponse.json({ error: 'keyId is required.', code: 'invalid_request' }, { status: 400 });
    }

    const { data, error } = await createAdminClient()
        .from('bot_api_keys')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', body.keyId)
        .eq('organization_id', auth.organizationId)
        .is('revoked_at', null)
        .select('id')
        .maybeSingle();
    if (error) return NextResponse.json({ error: 'The key could not be revoked.', code: 'internal' }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Key not found.', code: 'not_found' }, { status: 404 });
    return NextResponse.json({ id: data.id, revoked: true });
}

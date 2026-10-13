import { NextResponse } from 'next/server';
import { resolveSessionOrganization } from '@/lib/reports/session-org';
import { vaultEnabled } from '@/lib/vault/flags';

export const dynamic = 'force-dynamic';

/** Shell check only. Vault data routes stay 404 while the flag is off. */
export async function GET() {
    const session = await resolveSessionOrganization();
    if (!session.ok) {
        return NextResponse.json({ enabled: false });
    }
    return NextResponse.json({ enabled: vaultEnabled(process.env, session.organizationId) });
}

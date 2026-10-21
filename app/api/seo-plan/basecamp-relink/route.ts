import { NextResponse } from 'next/server';
import { resolveSessionOrganization } from '@/lib/reports/session-org';
import { basecampRelinkNesting, loadBasecampRelink } from '@/lib/seo-plan/basecamp-relink-server';
import { relinkBasecampChildren } from '@/lib/seo-plan/basecamp-relink-route';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * Repair flat Basecamp children for one client.
 * Send dryRun true first. Owner or admin of the signed-in organization.
 */
export async function POST(request: Request) {
    let body: unknown = null;
    try {
        body = await request.json();
    } catch {
        body = null;
    }
    const result = await relinkBasecampChildren(body, {
        session: resolveSessionOrganization,
        load: loadBasecampRelink,
        nesting: basecampRelinkNesting,
        log: line => {
            console.info(`[basecamp-relink] ${JSON.stringify(line)}`);
        },
    });
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}

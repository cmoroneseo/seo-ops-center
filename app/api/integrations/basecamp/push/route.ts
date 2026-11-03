import { NextRequest } from 'next/server';
import { createLiveBasecampPushPost } from '@/lib/basecamp/push-live';
import { requireTaskIntegrationManager } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

/** POST /api/integrations/basecamp/push */
export async function POST(req: NextRequest) {
    return createLiveBasecampPushPost(taskId => requireTaskIntegrationManager(taskId))(req);
}

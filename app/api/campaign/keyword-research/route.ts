import { NextRequest } from 'next/server';
import {
    createKeywordResearchHandler,
    loadKeywordResearchKey,
    loadKeywordResearchTarget,
} from '@/lib/campaign/keyword-research-route';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';

const handler = createKeywordResearchHandler({
    requireClientOrgMember,
    loadKey: loadKeywordResearchKey,
    loadTarget: loadKeywordResearchTarget,
    fetch,
});

export async function GET(req: NextRequest) {
    return handler.GET(req);
}

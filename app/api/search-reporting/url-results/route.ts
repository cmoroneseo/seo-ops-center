import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { loadUrlResults } from '@/lib/search-reporting/url-results-load';
import { createUrlResultsHandler } from '@/lib/search-reporting/url-results-route';

export const dynamic = 'force-dynamic';

const handler = createUrlResultsHandler({
    authorize: requireClientOrgMember,
    load: loadUrlResults,
    now: () => new Date(),
});

export async function GET(request: Request) {
    return handler(request);
}

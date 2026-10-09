import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { searchReportingEnabled } from '@/lib/search-reporting/flag';
import { loadLedger } from '@/lib/search-reporting/ledger-load';
import { createLedgerHandler } from '@/lib/search-reporting/ledger-route';

export const maxDuration = 60;

const handler = createLedgerHandler({
    authorize: requireClientOrgMember,
    enabled: searchReportingEnabled,
    load: loadLedger,
    now: () => new Date(),
});

export async function GET(request: Request) {
    return handler(request);
}

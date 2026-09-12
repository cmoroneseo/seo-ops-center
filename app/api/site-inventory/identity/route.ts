import { createSiteIdentityHandlers } from '@/lib/site-inventory/identity-route';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSiteIdentityReview, setSiteIdentityDecision } from '@/lib/supabase/site-identity';

const handlers = createSiteIdentityHandlers({
    authorize: requireClientOrgMember,
    createAdmin: createAdminClient,
    getReview: getSiteIdentityReview,
    setDecision: setSiteIdentityDecision,
});

export const GET = handlers.GET;

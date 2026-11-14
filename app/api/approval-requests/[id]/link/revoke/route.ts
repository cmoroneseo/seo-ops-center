import { staffLink } from '@/lib/approvals-v2/staff';
import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createRevokeLink } from '@/lib/gbp-approvals/revoke-link-route';
export const POST = staffLink(createRevokeLink({ agencyActor, createAdminClient }));

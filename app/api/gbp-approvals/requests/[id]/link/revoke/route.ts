import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createRevokeLink } from '@/lib/gbp-approvals/revoke-link-route';

export const dynamic = 'force-dynamic';
export const POST = createRevokeLink({ agencyActor, createAdminClient });

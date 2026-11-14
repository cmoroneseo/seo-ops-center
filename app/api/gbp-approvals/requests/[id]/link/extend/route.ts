import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createExtendLink } from '@/lib/gbp-approvals/extend-link-route';

export const dynamic = 'force-dynamic';
export const POST = createExtendLink({ agencyActor, createAdminClient });

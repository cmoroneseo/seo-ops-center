import { staffLink } from '@/lib/approvals-v2/staff';
import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createExtendLink } from '@/lib/gbp-approvals/extend-link-route';
export const POST = staffLink(createExtendLink({ agencyActor, createAdminClient }));

import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createIssueLink } from '@/lib/gbp-approvals/issue-link-route';

export const dynamic = 'force-dynamic';
export const POST = createIssueLink({ agencyActor, createAdminClient });

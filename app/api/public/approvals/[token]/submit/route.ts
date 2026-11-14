import { createSubmit } from '@/lib/gbp-approvals/submit-route';
import { createAdminClient } from '@/lib/supabase/admin';
import { clientIpHash } from '@/lib/gbp-approvals/live';

export const dynamic = 'force-dynamic';
export const POST = createSubmit({ createAdminClient, clientIpHash });

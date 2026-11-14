import { createUpload } from '@/lib/gbp-approvals/upload-route';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const POST = createUpload({ createAdminClient });

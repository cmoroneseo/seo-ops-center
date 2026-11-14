import { listRequests } from '@/lib/approvals-v2/staff';
export { POST } from '@/app/api/gbp-approvals/requests/route';
export const dynamic = 'force-dynamic';
export const GET = listRequests;

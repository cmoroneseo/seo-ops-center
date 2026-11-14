import { listRequests } from '@/lib/approvals-v2/staff';
export async function GET(request: Request, context: {
  params: Promise<{
    taskId: string;
  }>;
}) {
  return listRequests(request, (await context.params).taskId);
}

import { refreshGtmEventsReport } from '@/lib/reports/gtm-events-routes';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return refreshGtmEventsReport(id);
}

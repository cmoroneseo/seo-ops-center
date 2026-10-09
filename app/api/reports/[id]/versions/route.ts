import { NextRequest } from 'next/server';
import { reviewHandlers } from '@/lib/reports/review-handlers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return reviewHandlers.get(id, req);
}

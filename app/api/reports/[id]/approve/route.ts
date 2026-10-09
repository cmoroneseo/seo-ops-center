import { NextRequest } from 'next/server';
import { reviewHandlers } from '@/lib/reports/review-handlers';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return reviewHandlers.post(id, req);
}

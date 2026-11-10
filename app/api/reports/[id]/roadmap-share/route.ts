import { createRoadmapShare, listRoadmapShares, revokeRoadmapShare } from '@/lib/reports/roadmap-share-store';

export const dynamic = 'force-dynamic';

function originOf(req: Request): string {
    const host = req.headers.get('x-forwarded-host') || new URL(req.url).host;
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    return `${protocol}://${host}`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return listRoadmapShares(id);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return createRoadmapShare(id, originOf(req));
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const linkId = new URL(req.url).searchParams.get('linkId') ?? '';
    if (!linkId) return Response.json({ error: 'Missing link.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    return revokeRoadmapShare(id, linkId);
}

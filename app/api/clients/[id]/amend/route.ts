import { NextRequest, NextResponse } from 'next/server';
import { logClientActivity } from '@/lib/supabase/client-activity';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: clientId } = await params;
    const body = await req.json();
    const { organizationId, oldSeoHours, newSeoHours, oldBlogsPerMonth, newBlogsPerMonth, note, actorName, actorId } = body;

    if (!organizationId) return NextResponse.json({ error: 'organizationId required' }, { status: 400 });

    await logClientActivity({
        organizationId,
        clientId,
        eventType: 'retainer.amended',
        actorId: actorId ?? undefined,
        actorName: actorName ?? undefined,
        metadata: {
            oldSeoHours,
            newSeoHours,
            oldBlogsPerMonth,
            newBlogsPerMonth,
            note: note ?? null,
        },
    });

    return NextResponse.json({ ok: true });
}

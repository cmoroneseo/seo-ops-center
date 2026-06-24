import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  try {
    const clientId = req.nextUrl.searchParams.get('clientId');
    if (!clientId) {
      return NextResponse.json({ error: 'clientId required' }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
    }

    // Get Ahrefs credentials
    const { data: integrationRow } = await admin
      .from('client_integrations')
      .select('credentials')
      .eq('client_id', clientId)
      .eq('service', 'ahrefs')
      .eq('sync_status', 'active')
      .maybeSingle();

    if (!integrationRow?.credentials) {
      return NextResponse.json({ error: 'Ahrefs not connected for this client. Connect it in the Integrations tab first.' }, { status: 404 });
    }

    const apiKey = (integrationRow.credentials as Record<string, any>).api_key as string;
    if (!apiKey) {
      return NextResponse.json({ error: 'Ahrefs API key not found' }, { status: 404 });
    }

    // Get client domain
    const { data: gscRow } = await admin
      .from('client_integrations')
      .select('credentials')
      .eq('client_id', clientId)
      .eq('service', 'gsc')
      .maybeSingle();

    const { data: clientRow } = await admin
      .from('clients')
      .select('domain, name')
      .eq('id', clientId)
      .maybeSingle();

    const target =
      (gscRow?.credentials as any)?.site_url ||
      clientRow?.domain ||
      '';

    if (!target) {
      return NextResponse.json({ error: 'No website domain found. Set the client domain or connect GSC first.' }, { status: 400 });
    }

    const cleanTarget = target.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const headers = { Authorization: `Bearer ${apiKey}` };

    // Fetch organic keywords — top 100 by traffic
    const kwRes = await fetch(
      `https://api.ahrefs.com/v3/site-explorer/organic-keywords?target=${encodeURIComponent(cleanTarget)}&country=us&limit=100&order_by=traffic%3Adesc&output=json`,
      { headers },
    );

    if (!kwRes.ok) {
      const errText = await kwRes.text();
      return NextResponse.json({ error: `Ahrefs API error: ${errText.slice(0, 200)}` }, { status: 502 });
    }

    const kwData = await kwRes.json();
    const keywords = (kwData.keywords ?? []).map((k: any) => ({
      keyword: k.keyword,
      volume: k.volume ?? 0,
      difficulty: k.keyword_difficulty ?? 0,
      position: k.serp_position ?? null,
      traffic: k.traffic ?? 0,
      url: k.best_position_url ?? null,
    }));

    return NextResponse.json({
      domain: cleanTarget,
      totalOrganic: kwData.meta?.total ?? keywords.length,
      keywords,
    });
  } catch (err: any) {
    console.error('keyword-research error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch keywords' }, { status: 500 });
  }
}

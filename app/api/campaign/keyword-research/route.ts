import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

async function getAhrefsKey(clientId: string, admin: ReturnType<typeof createAdminClient>) {
  if (!admin) return null;
  const { data } = await admin
    .from('client_integrations')
    .select('credentials')
    .eq('client_id', clientId)
    .eq('service', 'ahrefs')
    .eq('sync_status', 'active')
    .maybeSingle();
  return (data?.credentials as Record<string, any>)?.api_key as string | undefined ?? null;
}

async function fetchOrganicKeywords(domain: string, apiKey: string, limit = 100) {
  const clean = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const res = await fetch(
    `https://api.ahrefs.com/v3/site-explorer/organic-keywords?target=${encodeURIComponent(clean)}&country=us&limit=${limit}&order_by=traffic%3Adesc&output=json`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ahrefs API error: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.keywords ?? []).map((k: any) => ({
    keyword: k.keyword,
    volume: k.volume ?? 0,
    difficulty: k.keyword_difficulty ?? 0,
    position: k.serp_position ?? null,
    traffic: k.traffic ?? 0,
  }));
}

export async function GET(req: NextRequest) {
  try {
    const clientId = req.nextUrl.searchParams.get('clientId');
    const mode = req.nextUrl.searchParams.get('mode') ?? 'domain';
    const competitorDomain = req.nextUrl.searchParams.get('competitor');

    if (!clientId) {
      return NextResponse.json({ error: 'clientId required' }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
    }

    const apiKey = await getAhrefsKey(clientId, admin);
    if (!apiKey) {
      return NextResponse.json({ error: 'Ahrefs not connected for this client. Connect it in the Integrations tab first.' }, { status: 404 });
    }

    if (mode === 'competitor') {
      if (!competitorDomain) {
        return NextResponse.json({ error: 'competitor domain required' }, { status: 400 });
      }
      const keywords = await fetchOrganicKeywords(competitorDomain, apiKey, 100);
      return NextResponse.json({ domain: competitorDomain, keywords, source: 'competitor' });
    }

    // Default: pull from client's own domain
    const { data: clientRow } = await admin
      .from('clients')
      .select('domain')
      .eq('id', clientId)
      .maybeSingle();

    const { data: gscRow } = await admin
      .from('client_integrations')
      .select('credentials')
      .eq('client_id', clientId)
      .eq('service', 'gsc')
      .maybeSingle();

    const target = clientRow?.domain || (gscRow?.credentials as any)?.site_url || '';
    if (!target) {
      return NextResponse.json({ error: 'No website domain found. Set the client domain in Edit Client first.' }, { status: 400 });
    }

    const keywords = await fetchOrganicKeywords(target, apiKey);
    return NextResponse.json({ domain: target, keywords, source: 'domain' });
  } catch (err: any) {
    console.error('keyword-research error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch keywords' }, { status: 500 });
  }
}

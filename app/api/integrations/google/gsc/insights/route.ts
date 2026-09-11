import { parseSearchInsightsAggregate } from '@/lib/gsc/insights';
import { historyDates, historyWindow } from '@/lib/gsc/history';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { createAdminClient } from '@/lib/supabase/admin';

export const maxDuration = 30;

export async function GET(req: Request) {
    const params = new URL(req.url).searchParams;
    const auth = await requireClientOrgMember(params.get('clientId'));
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

    const range = {
        start: params.get('start') ?? historyWindow().start,
        end: params.get('end') ?? historyWindow().end,
    };
    let dates: string[];
    try {
        dates = historyDates(range.start, range.end);
    } catch {
        return Response.json({ error: 'Invalid date range (maximum 31 days)' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: connection, error: connectionError } = await admin
        .from('client_integrations')
        .select('site_url:credentials->>site_url')
        .eq('organization_id', auth.organizationId)
        .eq('client_id', auth.clientId)
        .eq('service', 'gsc')
        .maybeSingle();
    if (connectionError) return Response.json({ error: 'Unable to read selected property' }, { status: 500 });
    const property = connection?.site_url;
    if (!property) return Response.json({ error: 'Select a GSC property first' }, { status: 400 });

    const { data, error } = await admin.rpc('get_gsc_search_insights', {
        p_organization_id: auth.organizationId,
        p_client_id: auth.clientId,
        p_property: property,
        p_start: range.start,
        p_end: range.end,
    });
    if (error) return Response.json({ error: 'Unable to aggregate query evidence' }, { status: 500 });

    try {
        const aggregate = parseSearchInsightsAggregate(data);
        return Response.json({
            property,
            ...range,
            ...aggregate,
            missingDates: dates.filter(date => !aggregate.days.some(day => day.date === date)),
            coverageNote: 'Google returns available top rows, not every query. Query/page and page totals must not be treated as property totals.',
        });
    } catch {
        return Response.json({ error: 'Unable to aggregate query evidence' }, { status: 500 });
    }
}

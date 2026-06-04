import { createAdminClient } from '@/lib/supabase/admin';
import { defaultSectionConfig, SectionConfig } from './sections';

export interface ReportRow {
    id: string;
    organization_id: string;
    client_id: string;
    report_month: string;
    title: string;
    executive_summary: string | null;
    recommendations: string | null;
    sections: SectionConfig[];
    status: 'draft' | 'published';
    created_by: string | null;
    created_at: string;
    updated_at: string;
    pdf_url: string | null;
}

/** List reports for an org, optionally filtered by client and/or month. */
export async function listReports(
    organizationId: string,
    opts: { clientId?: string; month?: string } = {},
): Promise<ReportRow[]> {
    const admin = createAdminClient();
    let q = admin
        .from('reports')
        .select('*')
        .eq('organization_id', organizationId)
        .order('report_month', { ascending: false })
        .order('created_at', { ascending: false });

    if (opts.clientId) q = q.eq('client_id', opts.clientId);
    if (opts.month) q = q.eq('report_month', opts.month);

    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as ReportRow[];
}

export async function getReport(id: string): Promise<ReportRow | null> {
    const admin = createAdminClient();
    const { data, error } = await admin.from('reports').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return data as ReportRow;
}

/** Create a report shell. Sections default to all-on. */
export async function createReport(params: {
    organizationId: string;
    clientId: string;
    reportMonth: string;
    title: string;
    createdBy?: string | null;
}): Promise<{ report?: ReportRow; error?: string }> {
    const admin = createAdminClient();
    const { organizationId, clientId, reportMonth, title, createdBy } = params;

    const insert: Record<string, unknown> = {
        organization_id: organizationId,
        client_id: clientId,
        report_month: reportMonth,
        title,
        sections: defaultSectionConfig(),
        status: 'draft',
    };
    // created_by references users(id); only set when it's a real UUID
    if (createdBy && createdBy !== 'user-1') insert.created_by = createdBy;

    const { data, error } = await admin.from('reports').insert(insert).select('*').single();
    if (error) return { error: error.message };
    return { report: data as ReportRow };
}

export async function updateReport(
    id: string,
    patch: Partial<Pick<ReportRow, 'title' | 'executive_summary' | 'recommendations' | 'sections' | 'status' | 'pdf_url'>>,
): Promise<{ report?: ReportRow; error?: string }> {
    const admin = createAdminClient();
    const { data, error } = await admin
        .from('reports')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();
    if (error) return { error: error.message };
    return { report: data as ReportRow };
}

export async function deleteReport(id: string): Promise<{ error?: string }> {
    const admin = createAdminClient();
    const { error } = await admin.from('reports').delete().eq('id', id);
    return error ? { error: error.message } : {};
}

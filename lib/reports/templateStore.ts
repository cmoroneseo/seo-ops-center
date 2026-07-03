import { createAdminClient } from '@/lib/supabase/admin';

export interface ReportTemplateRow {
    id: string;
    organization_id: string;
    name: string;
    blocks: { type: string; props: Record<string, any> }[];
    created_by: string | null;
    created_at: string;
}

export async function listTemplates(organizationId: string): Promise<ReportTemplateRow[]> {
    const admin = createAdminClient();
    const { data, error } = await admin
        .from('report_templates')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
    if (error) return [];
    return (data ?? []) as ReportTemplateRow[];
}

export async function createTemplate(params: {
    organizationId: string;
    name: string;
    blocks: { type: string; props: Record<string, any> }[];
    createdBy?: string | null;
}): Promise<{ template?: ReportTemplateRow; error?: string }> {
    const admin = createAdminClient();
    const insert: Record<string, unknown> = {
        organization_id: params.organizationId,
        name: params.name,
        blocks: params.blocks,
    };
    if (params.createdBy && params.createdBy !== 'user-1') insert.created_by = params.createdBy;

    const { data, error } = await admin.from('report_templates').insert(insert).select('*').single();
    if (error) return { error: error.message };
    return { template: data as ReportTemplateRow };
}

export async function deleteTemplate(id: string): Promise<{ error?: string }> {
    const admin = createAdminClient();
    const { error } = await admin.from('report_templates').delete().eq('id', id);
    return error ? { error: error.message } : {};
}

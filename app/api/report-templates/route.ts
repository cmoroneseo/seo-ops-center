import { NextRequest, NextResponse } from 'next/server';
import { listTemplates, createTemplate, deleteTemplate } from '@/lib/reports/templateStore';

/** GET /api/report-templates?orgId= — list an org's custom templates. */
export async function GET(req: NextRequest) {
    const orgId = req.nextUrl.searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });
    const templates = await listTemplates(orgId);
    return NextResponse.json({ templates });
}

/** POST /api/report-templates — body: { orgId, name, blocks } */
export async function POST(req: NextRequest) {
    const { orgId, name, blocks } = await req.json();
    if (!orgId || !name || !Array.isArray(blocks)) {
        return NextResponse.json({ error: 'orgId, name and blocks required' }, { status: 400 });
    }
    const { template, error } = await createTemplate({ organizationId: orgId, name, blocks });
    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ template });
}

/** DELETE /api/report-templates?id= */
export async function DELETE(req: NextRequest) {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const { error } = await deleteTemplate(id);
    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ success: true });
}

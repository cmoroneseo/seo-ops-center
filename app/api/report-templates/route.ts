import { NextRequest } from 'next/server';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';
import { createTemplateHandlers } from '@/lib/reports/template-routes';
import { createTemplate, deleteTemplate, getTemplate, listTemplates } from '@/lib/reports/templateStore';

const handlers = createTemplateHandlers({
    requireOrganizationMember,
    listTemplates,
    getTemplate,
    createTemplate,
    deleteTemplate,
});

export async function GET(req: NextRequest) {
    return handlers.list(req);
}

export async function POST(req: NextRequest) {
    return handlers.create(req);
}

export async function DELETE(req: NextRequest) {
    return handlers.remove(req);
}

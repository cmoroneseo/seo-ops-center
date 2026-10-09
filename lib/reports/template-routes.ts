import { isUuid, requireOrgAccess, type ReportAccessDeps } from './access';
import type { ReportTemplateRow } from './templateStore';

export interface TemplateRouteDeps extends Pick<ReportAccessDeps, 'requireOrganizationMember'> {
    listTemplates: (organizationId: string) => Promise<ReportTemplateRow[]>;
    getTemplate: (id: string) => Promise<ReportTemplateRow | null>;
    createTemplate: (params: {
        organizationId: string;
        name: string;
        blocks: { type: string; props: Record<string, unknown> }[];
        createdBy?: string | null;
    }) => Promise<{ template?: ReportTemplateRow; error?: string }>;
    deleteTemplate: (id: string, organizationId: string) => Promise<{ error?: string }>;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

function parseBlocks(value: unknown): { type: string; props: Record<string, unknown> }[] | null {
    if (!Array.isArray(value) || value.length > 100) return null;
    const blocks: { type: string; props: Record<string, unknown> }[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const type = (item as { type?: unknown }).type;
        const props = (item as { props?: unknown }).props ?? {};
        if (typeof type !== 'string' || type.length === 0) return null;
        if (props === null || typeof props !== 'object' || Array.isArray(props)) return null;
        blocks.push({ type, props: props as Record<string, unknown> });
    }
    return blocks;
}

export function createTemplateHandlers(deps: TemplateRouteDeps) {
    return {
        async list(request: Request) {
            const access = await requireOrgAccess(new URL(request.url).searchParams.get('orgId'), 'read', deps);
            if (!access.ok) return json({ error: access.error }, access.status);
            const templates = await deps.listTemplates(access.auth.organizationId);
            return json({ templates });
        },

        async create(request: Request) {
            let body: Record<string, unknown>;
            try {
                const parsed = await request.json();
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'Invalid request' }, 400);
                body = parsed as Record<string, unknown>;
            } catch {
                return json({ error: 'Invalid JSON' }, 400);
            }
            const access = await requireOrgAccess(body.orgId, 'write', deps);
            if (!access.ok) return json({ error: access.error }, access.status);
            const name = typeof body.name === 'string' ? body.name.trim() : '';
            if (name.length < 1 || name.length > 120) return json({ error: 'Invalid name' }, 400);
            const blocks = parseBlocks(body.blocks);
            if (!blocks) return json({ error: 'Invalid blocks' }, 400);
            const created = await deps.createTemplate({
                organizationId: access.auth.organizationId,
                name,
                blocks,
                createdBy: access.auth.userId,
            });
            if (created.error || !created.template) return json({ error: 'Unable to save template' }, 500);
            return json({ template: created.template });
        },

        async remove(request: Request) {
            const id = new URL(request.url).searchParams.get('id');
            if (!isUuid(id)) return json({ error: 'Not found' }, 404);
            const template = await deps.getTemplate(id);
            if (!template) return json({ error: 'Not found' }, 404);
            const access = await requireOrgAccess(template.organization_id, 'write', deps);
            if (!access.ok) {
                if (access.status === 401 || access.status === 500) return json({ error: access.error }, access.status);
                return json({ error: 'Not found' }, 404);
            }
            const result = await deps.deleteTemplate(template.id, template.organization_id);
            if (result.error) return json({ error: 'Unable to delete template' }, 500);
            return json({ success: true });
        },
    };
}

import { isUuid } from './access-policy';
import type { PortalClientScope } from './session';

type PreviewAuthorization = { ok: true; clientId: string; organizationId: string }
    | { ok: false; status: number; error: string };

/** No client-visible data is read until staff membership has been verified. */
export async function resolvePortalPreview(clientId: string, dependencies: {
    authorize(clientId: string): Promise<PreviewAuthorization>;
    readScope(clientId: string, organizationId: string): Promise<PortalClientScope | null>;
}) {
    if (!isUuid(clientId)) return { ok: false as const, status: 404, error: 'Client not found' };
    const auth = await dependencies.authorize(clientId);
    if (!auth.ok) return auth;
    const scope = await dependencies.readScope(auth.clientId, auth.organizationId);
    if (!scope || scope.clientId !== auth.clientId || scope.organizationId !== auth.organizationId) {
        return { ok: false as const, status: 404, error: 'Client not found' };
    }
    return { ok: true as const, scope };
}

export type PortalPage = 'home' | 'plan' | 'pending' | 'messages' | 'reports' | 'report';

export function previewPage(path: string[] = []): { page: PortalPage; reportId?: string } | null {
    if (path.length === 0) return { page: 'home' };
    if (path.length === 1 && ['plan', 'pending', 'messages', 'reports'].includes(path[0])) {
        return { page: path[0] as PortalPage };
    }
    if (path.length === 2 && path[0] === 'reports' && isUuid(path[1])) {
        return { page: 'report', reportId: path[1] };
    }
    return null;
}

/** Rebase only portal links. Review handoffs are handled as disabled actions. */
export function portalViewHref(href: string, basePath = '/portal'): string {
    if (href === '/portal' || href.startsWith('/portal/') || href.startsWith('/portal#')) {
        return `${basePath}${href.slice('/portal'.length)}`;
    }
    return href;
}

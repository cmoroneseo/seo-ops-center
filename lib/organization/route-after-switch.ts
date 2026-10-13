/**
 * Org-level page to open when the current URL names a client or record that
 * belongs to the organization being left. List pages stay put.
 * Null means the route is already organization-level.
 */
export function routeAfterOrganizationChange(pathname: string): string | null {
    const path = pathname.split('?')[0]?.split('#')[0] ?? '';
    const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
    if (/^\/workspace\/[^/]+/.test(normalized)) return '/workspace';
    if (/^\/client-portal\/[^/]+/.test(normalized)) return '/workspace';
    if (/^\/reports\/(?!close$)[^/]+/.test(normalized)) return '/reports';
    return null;
}

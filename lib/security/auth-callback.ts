import { safePortalNext } from '@/lib/portal/access-policy';

interface AuthenticatedUser {
    id: string;
    email: string;
}

interface Dependencies {
    exchangeCode(code: string): Promise<AuthenticatedUser | null>;
    consumeInvite(token: string, user: AuthenticatedUser): Promise<boolean>;
    consumePortalInvite?(token: string, user: AuthenticatedUser): Promise<boolean>;
    appOrigin: string;
}

function safeNext(value: string | null) {
    return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
        ? value
        : '/dashboard';
}

function errorRedirect(origin: string, loginPath = '/login') {
    const url = new URL(loginPath, origin);
    url.searchParams.set('error', 'Could not authenticate user');
    return Response.redirect(url);
}

export function createAuthCallbackGet(dependencies: Dependencies) {
    return async function getAuthCallback(req: Request): Promise<Response> {
        const params = new URL(req.url).searchParams;
        const code = params.get('code');
        if (!code) return errorRedirect(dependencies.appOrigin);

        const user = await dependencies.exchangeCode(code);
        if (!user?.id || !user.email) return errorRedirect(dependencies.appOrigin);

        const portalToken = params.get('portal_invite');
        if (portalToken) {
            const consumed = dependencies.consumePortalInvite
                ? await dependencies.consumePortalInvite(portalToken, user)
                : false;
            if (!consumed) return errorRedirect(dependencies.appOrigin, '/portal/login');
            return Response.redirect(new URL(safePortalNext(params.get('next')), dependencies.appOrigin));
        }

        const inviteToken = params.get('invite');
        if (inviteToken && !await dependencies.consumeInvite(inviteToken, user)) {
            return errorRedirect(dependencies.appOrigin);
        }

        const next = params.get('next');
        const destination = next?.startsWith('/portal')
            ? safePortalNext(next)
            : safeNext(next);
        return Response.redirect(new URL(destination, dependencies.appOrigin));
    };
}

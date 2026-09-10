import { GscError, selectGscProperty, type GscSite } from './gsc-properties';

type Authorized = { ok: true; clientId: string; organizationId: string; userId: string; actorName?: string };
type Authorization = Authorized | { ok: false; status: number; error: string };
export interface GscDependencies {
    authorize: (clientId: unknown) => Promise<Authorization>;
    load: (auth: Authorized) => Promise<{ token: string; credentials: Record<string, unknown> }>;
    catalog: (token: string) => Promise<GscSite[]>;
    save: (auth: Authorized, site: GscSite, credentials: Record<string, unknown>) => Promise<void>;
    activity: (auth: Authorized, site: GscSite, previous: unknown) => Promise<void>;
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
function failure(error: unknown) {
    return json({ error: error instanceof GscError ? error.message : 'Unable to update Search Console. Try again.' }, error instanceof GscError ? error.status : 500);
}
export function createGscHandlers(deps: GscDependencies) {
    return {
        async GET(request: Request) {
            try {
                const auth = await deps.authorize(new URL(request.url).searchParams.get('clientId'));
                if (!auth.ok) return json({ error: auth.error }, auth.status);
                const connection = await deps.load(auth);
                const sites = await deps.catalog(connection.token);
                return json({ sites, selectedSiteUrl: typeof connection.credentials.site_url === 'string' ? connection.credentials.site_url : null });
            } catch (error) { return failure(error); }
        },
        async POST(request: Request) {
            let body;
            try { body = await request.json(); } catch { return json({ error: 'Invalid request' }, 400); }
            if (!body || typeof body.clientId !== 'string' || typeof body.siteUrl !== 'string') return json({ error: 'Select a property for this client.' }, 400);
            try {
                const auth = await deps.authorize(body.clientId);
                if (!auth.ok) return json({ error: auth.error }, auth.status);
                const connection = await deps.load(auth);
                const site = selectGscProperty(await deps.catalog(connection.token), body.siteUrl);
                if (!site) return json({ error: 'This property is no longer accessible. Refresh the list and select an available property.' }, 400);
                await deps.save(auth, site, connection.credentials);
                // A saved configuration is not rolled back by a separate activity-feed failure.
                await deps.activity(auth, site, connection.credentials.site_url).catch(() => {});
                return json({ success: true, siteUrl: site.siteUrl });
            } catch (error) { return failure(error); }
        },
    };
}

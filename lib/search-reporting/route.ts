import type { GscDevice } from '@/lib/gsc/history';
import { buildSearchReporting } from './assemble';
import { isDevice, type LoadInput, type LoadedSearch } from './load';
import { parseRange } from './range';
import type { SurfaceFilter } from './types';

type ClientAuth =
    | { ok: true; userId: string; organizationId: string; clientId: string; role: 'owner' | 'admin' | 'member' | 'viewer' }
    | { ok: false; status: number; error: string };

export interface SearchReportingDeps {
    authorize: (clientId: unknown) => Promise<ClientAuth>;
    enabled: () => boolean;
    load: (input: LoadInput) => Promise<LoadedSearch>;
    schedule: (organizationId: string, clientId: string) => void;
    now: () => Date;
}

const SURFACES = new Set<SurfaceFilter>(['all', 'organic', 'map']);

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function cityList(value: string | null): string[] {
    if (!value) return [];
    return value.split(',').map(token => token.trim()).filter(token => token.length >= 3).slice(0, 100);
}

export function createSearchReportingHandler(deps: SearchReportingDeps) {
    return async function GET(request: Request) {
        const params = new URL(request.url).searchParams;
        const auth = await deps.authorize(params.get('clientId'));
        if (!auth.ok) return json({ error: auth.error }, auth.status);
        if (!deps.enabled()) return json({ error: 'Not found' }, 404);
        const range = parseRange(params.get('range'));
        if (!range) return json({ error: 'Invalid range' }, 400);
        const surfaceValue = params.get('surface') ?? 'all';
        if (!SURFACES.has(surfaceValue as SurfaceFilter)) return json({ error: 'Invalid surface' }, 400);
        const surface = surfaceValue as SurfaceFilter;
        const deviceValue = params.get('device');
        if (deviceValue && !isDevice(deviceValue)) return json({ error: 'Invalid device' }, 400);
        const device = (deviceValue as GscDevice | null) ?? null;

        const now = deps.now();
        try {
            const loaded = await deps.load({
                organizationId: auth.organizationId,
                clientId: auth.clientId,
                range: range.key,
                now,
                cityTokens: cityList(params.get('cities')),
                device,
            });
            if (loaded.connected) {
                try { deps.schedule(auth.organizationId, auth.clientId); } catch { /* cron retries */ }
            }
            return json(buildSearchReporting({
                now,
                range: range.key,
                surface,
                device,
                ...loaded,
            }));
        } catch {
            return json({ error: 'Unable to read Search Console history' }, 500);
        }
    };
}

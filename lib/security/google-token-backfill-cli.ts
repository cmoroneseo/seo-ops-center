import { createClient } from '@supabase/supabase-js';
import { executeGoogleTokenBackfill, type IntegrationSecretRow } from './google-token-backfill';
import { readKeyRing } from './google-token-crypto';

/**
 * Encrypt Google access and refresh tokens already stored on
 * client_integrations. Dry-run is the default.
 *
 *   node --import tsx lib/security/google-token-backfill-cli.ts --dry-run
 *   node --import tsx lib/security/google-token-backfill-cli.ts --commit --verify
 *   node --import tsx lib/security/google-token-backfill-cli.ts --commit --verify --org <uuid>
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and
 * SUPABASE_SERVICE_ROLE_KEY. Prints a count report and never prints tokens.
 */
export async function main(argv: string[], env: NodeJS.ProcessEnv, log: (line: string) => void = console.log): Promise<number> {
    const commit = argv.includes('--commit');
    const verify = argv.includes('--verify');
    const orgFlag = argv.indexOf('--org');
    const organizationId = orgFlag >= 0 ? argv[orgFlag + 1] : undefined;
    if (orgFlag >= 0 && !organizationId) {
        log('Missing organization id after --org');
        return 1;
    }

    const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        log('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
        return 1;
    }
    const ring = readKeyRing({
        GOOGLE_TOKEN_ENC_KEY: env.GOOGLE_TOKEN_ENC_KEY,
        GOOGLE_TOKEN_ENC_KEY_ID: env.GOOGLE_TOKEN_ENC_KEY_ID,
    });
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as IntegrationAdmin;
    const rows = await loadRows(admin, organizationId);
    if (!ring) {
        const report = await executeGoogleTokenBackfill({ rows, ring: null, dryRun: true, verify: false });
        log(JSON.stringify({ error: 'GOOGLE_TOKEN_ENC_KEY is not configured', ...report }));
        return 1;
    }
    const report = await executeGoogleTokenBackfill({
        rows,
        ring,
        dryRun: !commit,
        verify,
        write: async (row, next) => {
            const { data, error } = await admin
                .from('client_integrations')
                .update({ credentials: next })
                .eq('id', row.id)
                .eq('organization_id', row.organizationId)
                .filter('credentials', 'eq', JSON.stringify(row.credentials))
                .select('id')
                .maybeSingle();
            return error || !data ? 'conflict' : 'updated';
        },
        reread: async (row) => {
            const { data, error } = await admin
                .from('client_integrations')
                .select('credentials')
                .eq('id', row.id)
                .eq('organization_id', row.organizationId)
                .maybeSingle();
            if (error) throw new Error('Unable to reread integration');
            return data?.credentials ?? null;
        },
    });
    log(JSON.stringify(report));
    return report.failed > 0 ? 1 : 0;
}

interface IntegrationDbRow {
    id?: unknown;
    organization_id?: unknown;
    client_id?: unknown;
    service?: unknown;
    credentials?: unknown;
}

interface IntegrationFilter extends PromiseLike<{ data: IntegrationDbRow[] | null; error: { message?: string } | null }> {
    order(column: string): IntegrationFilter;
    range(from: number, to: number): IntegrationFilter;
    eq(column: string, value: string): IntegrationFilter;
    filter(column: string, operator: string, value: string): IntegrationFilter;
    select(columns: string): IntegrationFilter;
    maybeSingle(): Promise<{ data: IntegrationDbRow | null; error: { message?: string } | null }>;
}

interface IntegrationAdmin {
    from(table: string): {
        select(columns: string): IntegrationFilter;
        update(values: Record<string, unknown>): IntegrationFilter;
    };
}

async function loadRows(admin: IntegrationAdmin, organizationId?: string): Promise<IntegrationSecretRow[]> {
    const rows: IntegrationSecretRow[] = [];
    for (let from = 0; from < 20_000; from += 500) {
        let query = admin
            .from('client_integrations')
            .select('id, organization_id, client_id, service, credentials')
            .order('id')
            .range(from, from + 499);
        if (organizationId) query = query.eq('organization_id', organizationId);
        const { data, error } = await query;
        if (error) throw new Error('Unable to read integrations');
        for (const row of data ?? []) {
            rows.push({
                id: String(row.id),
                organizationId: String(row.organization_id),
                clientId: String(row.client_id),
                service: String(row.service),
                credentials: row.credentials,
            });
        }
        if ((data ?? []).length < 500) break;
    }
    return rows;
}

const entry = process.argv[1]?.replace(/\\/g, '/');
if (entry && import.meta.url.endsWith(entry)) {
    main(process.argv.slice(2), process.env).then(code => {
        process.exit(code);
    }).catch(() => {
        process.exit(1);
    });
}

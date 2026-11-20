import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createAdminClient } from '../../lib/supabase/admin';
import { phasePlanSteps } from '../../lib/seo-plan/plan-phases';
import {
    applyImport, buildPreview, parseCsv, parsePreviewCsv, planApply, tabs, toPreviewCsv, uuidPattern,
    type Grids, type ImportDeps, type Manifest,
} from '../../lib/sheet-import';

function failOnWrite(): never {
    throw new Error('Offline dry run cannot write');
}

const offlineDeps: ImportDeps = {
    findExistingImportKeys: async () => ({ planItems: [], tasks: [] }),
    getOrCreatePlan: failOnWrite,
    maxSortOrder: async () => null,
    insertPlanItems: failOnWrite,
    insertTasks: failOnWrite,
};

function databaseDeps(actor: string | undefined): ImportDeps {
    const db = createAdminClient();
    const orgs = new Map<string, string>();

    async function organization(clientId: string): Promise<string> {
        const cached = orgs.get(clientId);
        if (cached) return cached;
        const { data, error } = await db.from('clients').select('organization_id').eq('id', clientId).single();
        if (error || !data?.organization_id) throw new Error(`Could not resolve organization for client ${clientId}`);
        orgs.set(clientId, data.organization_id);
        return data.organization_id;
    }

    async function findPlan(clientId: string): Promise<string | null> {
        const { data, error } = await db.from('marketing_plans').select('id').eq('client_id', clientId).maybeSingle();
        if (error) throw new Error('Could not look up marketing plan');
        return data?.id ?? null;
    }

    async function existingKeys(table: 'marketing_plan_items' | 'tasks', clientId: string, keys: string[]) {
        const found: string[] = [];
        // Bound URL size and response size for larger exports.
        for (let index = 0; index < keys.length; index += 40) {
            const { data, error } = await db.from(table).select('import_key')
                .eq('client_id', clientId).in('import_key', keys.slice(index, index + 40));
            if (error) throw new Error(`Could not look up ${table} import keys (${error.code})`);
            found.push(...data.map(row => row.import_key));
        }
        return found;
    }

    async function insert<T extends { client_id: string }>(table: 'marketing_plan_items' | 'tasks', rows: T[]) {
        const organizationId = await organization(rows[0].client_id);
        const payloads = rows.map(row => ({
            ...row,
            organization_id: organizationId,
            ...(table === 'tasks' ? { created_by: actor } : {}),
        }));
        const { error, count } = await db.from(table).upsert(payloads, {
            onConflict: 'client_id,import_key', ignoreDuplicates: true, count: 'exact',
        });
        if (error) throw new Error(`Could not insert ${table} (${error.code})`);
        if (count === null) throw new Error(`Missing insert count for ${table}`);
        return count;
    }

    return {
        async findExistingImportKeys(clientId, keys) {
            const [planItems, tasks] = await Promise.all([
                existingKeys('marketing_plan_items', clientId, keys),
                existingKeys('tasks', clientId, keys),
            ]);
            return { planItems, tasks };
        },
        findPlan,
        async getOrCreatePlan(clientId, title) {
            const existing = await findPlan(clientId);
            if (existing) return existing;
            const { error } = await db.from('marketing_plans').upsert({
                client_id: clientId, organization_id: await organization(clientId), title, steps: phasePlanSteps(),
            }, { onConflict: 'client_id', ignoreDuplicates: true });
            if (error) throw new Error(`Could not create marketing plan (${error.code})`);
            const id = await findPlan(clientId);
            if (!id) throw new Error('Could not resolve newly created marketing plan');
            return id;
        },
        async maxSortOrder(planId) {
            const { data, error } = await db.from('marketing_plan_items').select('sort_order')
                .eq('marketing_plan_id', planId).order('sort_order', { ascending: false }).limit(1).maybeSingle();
            if (error) throw new Error('Could not look up plan item sort order');
            return data?.sort_order ?? null;
        },
        insertPlanItems: rows => insert('marketing_plan_items', rows),
        insertTasks: rows => insert('tasks', rows),
    };
}

async function main() {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'preview') {
        const { values } = parseArgs({ args, options: { manifest: { type: 'string' }, out: { type: 'string' } } });
        if (!values.manifest || !values.out) throw new Error('Usage: preview --manifest <file.json> --out <preview.csv>');
        const manifestPath = resolve(values.manifest);
        const manifest: Manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        const grids: Grids = {};
        for (const client of manifest.clients) {
            grids[client.clientId] = {};
            for (const tab of tabs) {
                const path = client.tabs?.[tab];
                if (path) grids[client.clientId][tab] = parseCsv(await readFile(resolve(dirname(manifestPath), path), 'utf8'));
            }
        }
        const rows = buildPreview(manifest, grids);
        await writeFile(values.out, toPreviewCsv(rows));
        console.log(`Wrote ${rows.length} preview rows`);
    } else if (command === 'apply') {
        const { values } = parseArgs({ args, options: {
            preview: { type: 'string' }, execute: { type: 'boolean' }, confirm: { type: 'string' }, actor: { type: 'string' },
        } });
        if (!values.preview) throw new Error('Usage: apply --preview <approved.csv> [--execute --confirm <count> --actor <uuid>]');
        const plan = planApply(parsePreviewCsv(await readFile(values.preview, 'utf8')));
        if (plan.errors.length) throw new Error(plan.errors.join('\n'));
        if (values.execute && (values.confirm !== String(plan.approvedCount) || !uuidPattern.test(values.actor ?? ''))) {
            throw new Error(`Execute requires --confirm "${plan.approvedCount}" and --actor <user uuid>`);
        }
        const hasEnv = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
        if (values.execute && !hasEnv) throw new Error('Missing Supabase admin credentials');
        if (!hasEnv) console.warn('Dry run is offline. Existing keys and plan sort order will be resolved during execution.');
        const result = await applyImport(plan, hasEnv ? databaseDeps(values.actor) : offlineDeps, { execute: values.execute });
        if (values.execute) console.log(JSON.stringify({ inserted: result.inserted, skipped: result.skipped }));
        else console.log(JSON.stringify({ mode: 'dry-run', ...result }, null, 2));
    } else {
        throw new Error('Choose preview or apply');
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Import failed');
    process.exitCode = 1;
});

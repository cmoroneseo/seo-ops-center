/**
 * import-workbook.ts — Stage 3, step 2 (load).
 *
 * Loads scripts/workbook-data.json (produced by export-workbook.py) into Supabase
 * using the service-role key. Joins everything on client_slug, maps account-manager
 * names to user IDs where a matching user exists, and preserves unmapped columns in
 * custom_fields (lossless). Business mappings reuse lib/seo-ops-logic.ts.
 *
 * Prereqs:
 *   1. migrations/003_seo_ops_domain.sql has been applied to the database.
 *   2. python3 scripts/export-workbook.py has been run.
 *   3. .env.local has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *
 * Run (Node >= 23):
 *   node --env-file=.env.local scripts/import-workbook.ts                 # dry run summary
 *   node --env-file=.env.local scripts/import-workbook.ts --commit        # write to DB
 *   node --env-file=.env.local scripts/import-workbook.ts --commit --reset # clear managed data first
 *
 * The target org is the internal "Marketing Empire Group" (created with
 * is_internal = true if it doesn't already exist). Override with --org "Name".
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  mapLegacyDeliverableStatus,
  type DeliverableStatus,
} from '../lib/seo-ops-logic.ts';

// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const RESET = args.includes('--reset');
const orgFlagIdx = args.indexOf('--org');
const ORG_NAME = orgFlagIdx >= 0 ? args[orgFlagIdx + 1] : 'Marketing Empire Group';
const SLUG = ORG_NAME.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local).');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(path.join(__dirname, 'workbook-data.json'), 'utf8'));

function chunk<T>(arr: T[], n = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
const log = (...a: unknown[]) => console.log(...a);
function mapDeliverableType(raw?: string | null): string {
  const t = (raw || '').toLowerCase();
  if (t.includes('backlink') || t.includes('link')) return 'Backlink';
  if (t.includes('gbp') || t.includes('business profile')) return 'GBP';
  if (t.includes('blog') || t.includes('content')) return 'Content';
  return raw ? 'Other' : 'Content';
}

async function ensureOrg(): Promise<string> {
  const { data: existing } = await db.from('organizations').select('id, name, is_internal').eq('slug', SLUG).maybeSingle();
  if (existing) {
    if (!existing.is_internal && COMMIT) {
      await db.from('organizations').update({ is_internal: true, plan_type: 'enterprise', subscription_status: 'active' }).eq('id', existing.id);
    }
    log(`Using existing org "${existing.name}" (${existing.id})${existing.is_internal ? '' : ' [will flag internal]'}`);
    return existing.id;
  }
  if (!COMMIT) {
    log(`[dry-run] would CREATE internal org "${ORG_NAME}" (slug ${SLUG})`);
    return '00000000-0000-0000-0000-000000000000';
  }
  const { data: created, error } = await db.from('organizations')
    .insert({ name: ORG_NAME, slug: SLUG, is_internal: true, plan_type: 'enterprise', subscription_status: 'active' })
    .select('id').single();
  if (error) throw error;
  log(`Created internal org "${ORG_NAME}" (${created.id})`);
  return created.id;
}

async function buildUserMap(): Promise<Map<string, string>> {
  // name (lowercased full_name / first token / email local-part) -> user id
  const { data: users } = await db.from('users').select('id, full_name, email');
  const m = new Map<string, string>();
  for (const u of users || []) {
    if (u.full_name) {
      m.set(u.full_name.toLowerCase().trim(), u.id);
      m.set(u.full_name.toLowerCase().trim().split(/\s+/)[0], u.id); // first name (Carlos/Abel)
    }
    if (u.email) m.set(u.email.toLowerCase().split('@')[0], u.id);
  }
  return m;
}
const amId = (m: Map<string, string>, name?: string | null) =>
  (name ? m.get(name.toLowerCase().trim()) ?? null : null);

async function resetOrg(orgId: string) {
  if (!COMMIT) { log('[dry-run] would RESET managed tables for org'); return; }
  for (const t of ['team_bonus', 'client_change_log', 'deliverables', 'time_logs', 'monthly_plans', 'clients']) {
    const { error } = await db.from(t).delete().eq('organization_id', orgId);
    if (error) throw new Error(`reset ${t}: ${error.message}`);
  }
  log('Reset: cleared managed tables for org');
}

async function run() {
  log(`\n=== Workbook import (${COMMIT ? 'COMMIT' : 'DRY RUN'}${RESET ? ' +reset' : ''}) ===`);
  log('Source counts:', JSON.stringify(data._meta?.counts ?? {}));

  const orgId = await ensureOrg();
  const users = await buildUserMap();
  log(`Matched ${users.size ? '' : 'NO '}existing users for account-manager mapping${users.size ? '' : ' (names kept as text)'}.`);
  if (RESET) await resetOrg(orgId);

  // analytics map: slug -> {ga4, gsc}
  const analytics = new Map<string, { ga4_property_id: string | null; gsc_url: string | null }>();
  for (const a of data.analytics_map) analytics.set(a.client_slug, { ga4_property_id: a.ga4_property_id, gsc_url: a.gsc_url });

  // ---- clients ----
  // Deduplicate by slug — keep last occurrence (most-recent data wins for dupes).
  const dedupedClients = Object.values(
    data.clients.reduce((acc: any, c: any) => { if (c.client_slug) acc[c.client_slug] = c; return acc; }, {})
  );
  log(`Clients: ${data.clients.length} rows → ${dedupedClients.length} after dedup`);

  const clientRows = dedupedClients.map((c: any) => {
    const an = analytics.get(c.client_slug);
    return {
      organization_id: orgId,
      name: c.name,
      client_slug: c.client_slug,
      status: c.status,
      launch_date: c.launch_date,
      original_launch_date: c.original_launch_date,
      launch_date_override: c.launch_date_override,
      seo_hours: c.seo_hours,
      engagement_model: c.engagement_model,
      deliverables_spec: c.deliverables_spec,
      blogs_due_per_month: c.blogs_due_per_month,
      account_manager_id: amId(users, c.account_manager_name),
      account_manager_name: c.account_manager_name,
      tier: c.tier != null ? Math.round(c.tier) : null,
      target_blog_count: c.target_blog_count != null ? Math.round(c.target_blog_count) : null,
      delivered_override: c.delivered_override != null ? Math.round(c.delivered_override) : null,
      notes: c.notes,
      planning_tags: c.planning_tags,
      campaign_start: c.campaign?.start ?? null,
      campaign_end: c.campaign?.end ?? null,
      campaign_total_blogs: c.campaign?.total_blogs != null ? Math.round(c.campaign.total_blogs) : null,
      campaign_total_hours: c.campaign?.total_hours ?? null,
      ga4_property_id: an?.ga4_property_id ?? null,
      gsc_url: an?.gsc_url ?? null,
      custom_fields: { ...(c.custom_fields || {}), hour_type: c.hour_type, status_raw: c.status_raw },
    };
  });

  const slugToId = new Map<string, string>();
  if (COMMIT) {
    for (const part of chunk(clientRows)) {
      const { data: up, error } = await db.from('clients').upsert(part, { onConflict: 'organization_id,client_slug' }).select('id, client_slug');
      if (error) throw new Error(`clients: ${error.message}`);
      for (const row of up || []) slugToId.set(row.client_slug, row.id);
    }
    log(`Clients upserted: ${slugToId.size}`);
  } else {
    log(`[dry-run] would upsert ${clientRows.length} clients`);
    data.clients.forEach((c: any) => slugToId.set(c.client_slug, 'dry'));
  }
  const cid = (slug: string) => slugToId.get(slug);

  // ---- deliverables ----
  let skippedDel = 0;
  const delRows = data.deliverables.map((d: any) => {
    const client_id = cid(d.client_slug);
    if (!client_id) { skippedDel++; return null; }
    const status = mapLegacyDeliverableStatus(d.status_raw, d.delivered_on_raw) as DeliverableStatus;
    const delivered = status === 'Published' || status === 'Approved';
    return {
      organization_id: orgId, client_id,
      title: d.title,
      type: mapDeliverableType(d.type_raw),
      status,
      due_date: d.due_date,
      month: d.month,
      account_manager_id: amId(users, d.account_manager_name),
      notes: d.notes,
      delivered_on: delivered && d.due_date ? d.due_date : null,
      custom_fields: { type_raw: d.type_raw, delivered_on_raw: d.delivered_on_raw },
    };
  }).filter(Boolean);

  // ---- time_logs ----
  let skippedTL = 0;
  const tlRows = data.time_logs.map((t: any) => {
    const client_id = cid(t.client_slug);
    if (!client_id) { skippedTL++; return null; }
    return {
      organization_id: orgId, client_id,
      user_id: amId(users, t.account_manager_name),
      date: t.date, hours: t.hours, description: t.description, billable: true,
    };
  }).filter(Boolean);

  // ---- monthly_plans ----
  let skippedMP = 0;
  const mpRows = data.monthly_plans.map((p: any) => {
    const client_id = cid(p.client_slug);
    if (!client_id) { skippedMP++; return null; }
    return { organization_id: orgId, client_id, month: p.month, weeks: p.weeks, notes: p.notes };
  }).filter(Boolean);

  // ---- client_change_log ----
  const clRows = data.client_change_log.map((c: any) => {
    const client_id = cid(c.client_slug);
    if (!client_id) return null;
    return {
      organization_id: orgId, client_id,
      changed_by_id: amId(users, c.changed_by),
      date_of_change: c.date_of_change ?? undefined,
      prev_seo_hours: c.prev_seo_hours, new_seo_hours: c.new_seo_hours,
      prev_blog_count: c.prev_blog_count, new_blog_count: c.new_blog_count,
      effective_date: c.effective_date, notes: c.notes,
    };
  }).filter(Boolean);

  // ---- team_bonus ----
  const tbRows = data.team_bonus.map((b: any) => ({
    organization_id: orgId,
    user_id: amId(users, b.member_name),
    member_name: b.member_name, month: b.month,
    base_from_hours: b.base_from_hours, kpi_bonus: b.kpi_bonus, cap: b.cap, notes: b.notes,
  }));

  if (COMMIT) {
    for (const part of chunk(delRows)) { const { error } = await db.from('deliverables').insert(part); if (error) throw new Error(`deliverables: ${error.message}`); }
    for (const part of chunk(tlRows)) { const { error } = await db.from('time_logs').insert(part); if (error) throw new Error(`time_logs: ${error.message}`); }
    for (const part of chunk(mpRows)) { const { error } = await db.from('monthly_plans').upsert(part, { onConflict: 'client_id,month' }); if (error) throw new Error(`monthly_plans: ${error.message}`); }
    for (const part of chunk(clRows)) { const { error } = await db.from('client_change_log').insert(part); if (error) throw new Error(`client_change_log: ${error.message}`); }
    if (tbRows.length) { const { error } = await db.from('team_bonus').insert(tbRows); if (error) throw new Error(`team_bonus: ${error.message}`); }
  }

  log('\n--- Load summary ---');
  log(`clients:          ${COMMIT ? slugToId.size : clientRows.length}`);
  log(`deliverables:     ${delRows.length}  (skipped, no client match: ${skippedDel})`);
  log(`time_logs:        ${tlRows.length}  (skipped: ${skippedTL})`);
  log(`monthly_plans:    ${mpRows.length}  (skipped: ${skippedMP})`);
  log(`client_change_log:${clRows.length}`);
  log(`team_bonus:       ${tbRows.length}`);

  // ---- reconcile vs workbook ----
  const activeClients = data.clients.filter((c: any) => c.status === 'active').length;
  const totalHours = data.time_logs.reduce((sum: number, t: any) => sum + (t.hours || 0), 0);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const deliveredThisMonth = data.deliverables.filter(
    (d: any) => d.month === thisMonth && (d.status_raw || '').toLowerCase() === 'delivered',
  ).length;
  log('\n--- Reconcile (compare against the workbook Dashboard / Summary) ---');
  log(`active clients:            ${activeClients}`);
  log(`total hours logged (all):  ${totalHours.toFixed(1)}`);
  log(`blogs delivered ${thisMonth}: ${deliveredThisMonth}`);

  if (!COMMIT) log('\nDry run only. Re-run with --commit to write. Add --reset for a clean reload.');
  else log('\nDone. Verify the reconcile numbers against the workbook before cutover.');
}

run().catch((e) => { console.error('\nImport failed:', e.message); process.exit(1); });

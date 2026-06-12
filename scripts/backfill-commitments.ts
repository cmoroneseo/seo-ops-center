/**
 * backfill-commitments.ts — Deliverables Management migration step.
 *
 * Creates one deliverable_commitments row per client from the legacy cadence
 * fields (blogs_due_per_month / deliverables_spec / campaign_total_blogs),
 * then best-effort links existing deliverables rows to their commitment by
 * client + type + (subtype null). Suppresses the change-log triggers via the
 * app.suppress_change_log GUC is not possible through PostgREST, so the
 * trigger's 'created' entries are expected — they double as a migration audit.
 *
 * Prereqs:
 *   1. migrations/015_deliverable_commitments.sql has been applied.
 *   2. .env.local has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *
 * Run (Node >= 23):
 *   node --env-file=.env.local scripts/backfill-commitments.ts            # dry run
 *   node --env-file=.env.local scripts/backfill-commitments.ts --commit   # write to DB
 */
import { createClient } from '@supabase/supabase-js';
import { parseBlogsPerMonth, parseCampaignBlogs } from '../lib/seo-ops-logic.ts';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local).');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  const { data: clients, error } = await db
    .from('clients')
    .select('id, organization_id, name, status, engagement_model, deliverables_spec, blogs_due_per_month, campaign_total_blogs, campaign_start, campaign_end, launch_date, launch_date_override, account_manager_id');
  if (error) throw error;

  const { data: existing, error: exErr } = await db
    .from('deliverable_commitments')
    .select('client_id');
  if (exErr) throw exErr;
  const hasCommitment = new Set((existing ?? []).map((r) => r.client_id));

  const plans: { clientName: string; row: Record<string, unknown> }[] = [];

  for (const c of clients ?? []) {
    if (hasCommitment.has(c.id)) {
      console.log(`skip   ${c.name} — already has commitments`);
      continue;
    }

    const isCampaign = c.engagement_model === 'Campaign';
    const campaignTotal = c.campaign_total_blogs ?? parseCampaignBlogs(c.deliverables_spec);
    const perMonth = Number(c.blogs_due_per_month ?? 0) || parseBlogsPerMonth(c.deliverables_spec);

    if (isCampaign && campaignTotal) {
      plans.push({
        clientName: c.name,
        row: {
          organization_id: c.organization_id,
          client_id: c.id,
          type: 'Content',
          subtype: 'blog',
          title: 'Blog Posts',
          quantity_per_month: perMonth > 0 ? perMonth : campaignTotal, // one-shot if no cadence
          cadence: 'monthly',
          engagement_model: 'Campaign',
          total_quantity: campaignTotal,
          starts_on: c.campaign_start ?? c.launch_date_override ?? c.launch_date ?? new Date().toISOString().slice(0, 10),
          ends_on: c.campaign_end ?? null,
          is_active: c.status === 'active',
          default_assignee_id: null,
          counts_toward_hours: true,
          notes: `Backfilled from deliverables_spec: "${c.deliverables_spec ?? ''}"`,
        },
      });
    } else if (perMonth > 0) {
      plans.push({
        clientName: c.name,
        row: {
          organization_id: c.organization_id,
          client_id: c.id,
          type: 'Content',
          subtype: 'blog',
          title: 'Blog Posts',
          quantity_per_month: perMonth,
          cadence: 'monthly',
          engagement_model: 'Retainer',
          starts_on: c.launch_date_override ?? c.launch_date ?? new Date().toISOString().slice(0, 10),
          is_active: c.status === 'active',
          default_assignee_id: null,
          counts_toward_hours: true,
          notes: `Backfilled from deliverables_spec: "${c.deliverables_spec ?? ''}"`,
        },
      });
    } else {
      console.log(`none   ${c.name} — no blog cadence found (spec: "${c.deliverables_spec ?? ''}")`);
    }
  }

  console.log(`\n${plans.length} commitments to create:`);
  for (const p of plans) {
    const r = p.row;
    console.log(
      `  ${p.clientName}: ${r.quantity_per_month}/mo ${r.engagement_model}` +
      `${r.total_quantity ? ` (cap ${r.total_quantity})` : ''} from ${r.starts_on}${r.is_active ? '' : ' [inactive]'}`,
    );
  }

  if (!COMMIT) {
    console.log('\nDry run — re-run with --commit to write.');
    return;
  }

  // Insert commitments
  let created = 0;
  const commitmentByClient = new Map<string, string>();
  for (const p of plans) {
    const { data, error: insErr } = await db
      .from('deliverable_commitments')
      .insert([p.row])
      .select('id, client_id')
      .single();
    if (insErr) {
      console.error(`  ERROR creating commitment for ${p.clientName}: ${insErr.message}`);
      continue;
    }
    commitmentByClient.set(data.client_id, data.id);
    created++;
  }
  console.log(`\nCreated ${created} commitments.`);

  // Best-effort link existing Content deliverables to the client's blog commitment
  let linked = 0;
  for (const [clientId, commitmentId] of commitmentByClient) {
    const { data: updated, error: linkErr } = await db
      .from('deliverables')
      .update({ commitment_id: commitmentId, subtype: 'blog' })
      .eq('client_id', clientId)
      .eq('type', 'Content')
      .is('commitment_id', null)
      .select('id');
    if (linkErr) {
      console.error(`  ERROR linking deliverables for client ${clientId}: ${linkErr.message}`);
      continue;
    }
    linked += updated?.length ?? 0;
  }
  console.log(`Linked ${linked} existing deliverables to commitments.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

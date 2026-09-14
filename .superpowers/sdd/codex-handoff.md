# Attribution Phase 1 — Codex Handoff

## Current checkpoint — 2026-09-13 (supersedes the historical notes below)

- **Branch:** `feat/attribution-design-spec`; **do not merge yet**.
- **Current checkpoint:** the commit containing this file (`git rev-parse --short HEAD`), titled `Enforce attribution canary integrity`.
- **PR:** #82. The PR has not been updated with the current local work yet.
- **Database project:** `sgszojorcftyaknruckh`.
- **Applied remotely:** migrations 056, 057, and 058.
- **Not applied remotely:** migration 059 (`migrations/059_attribution_advisor_fixes.sql`).
- **Working tree:** clean at handoff.

### What Codex completed

- Enforced Sandbox rollout in the database with `attribution_enabled_organizations`; only org `06e536b9-beac-49bc-8c96-1df021102590` is enabled.
- Collector independently checks that allowlist before quota or storage work; GSC enrichment is also scoped to enabled orgs.
- Added stable `client_event_id` values and conflict-ignore ingestion. Sending the same real Sandbox request twice returned 200 twice but stored exactly one row.
- Replaced the rate limiter with atomic per-IP (100/minute) and per-site (500/minute, 2,000/hour, 10,000/day) limits. Rejected traffic is not charged to accepted-event quotas.
- Stopped tracking after permanent 400/403/404 collector responses; retained retry for transient/network failures.
- Replaced broad HDYHAU substring matching with an exact field-name allowlist.
- Added HMAC/site-scoped visitor IDs, 128KB body limit, CORS-simple requests, retry preservation, pause/tel controls, CSP/privacy guidance, canonical production snippets, strict Google-domain matching, and directional pipeline language.
- Applied migration 058 remotely and verified one enabled org and one-row idempotency on the real database.

### Verification evidence

- Before migration 059: `npm test` passed **1,187/1,187**; `npm run typecheck`, `npm run security:all`, `git diff --check`, and `npm run build` passed.
- After writing migration 059: `node --import tsx --test lib/attribution/schema.test.ts` passed **10/10** and the schema mirror/order is correct.
- Migration 059 was prompted by Supabase advisors: it removes the authenticated SECURITY DEFINER rollout RPC and adds four composite FK indexes.

### Exact continuation steps

1. Review the current diff and run `node --import tsx --test lib/attribution/*.test.ts lib/supabase/attribution.test.ts` plus `npm run typecheck`.
2. Apply `migrations/059_attribution_advisor_fixes.sql` to Supabase as migration name `059_attribution_advisor_fixes`.
3. Re-run Supabase security/performance advisors. Expected remaining attribution security notices are the intentional authenticated GraphQL visibility for RLS-protected sites/events/conversions and the service-only rate-limit table with no user policy. The SECURITY DEFINER warning should be gone; the four composite FK notices should be gone.
4. Run `npm test`, `npm run security:all`, `npm run build`, and `git diff --check`.
5. Request one final independent review, then push `feat/attribution-design-spec` to update PR #82. Do not merge without Carlos's approval.

### Deliberately deferred beyond the Sandbox canary

- Browser events remain forgeable unverified telemetry; authoritative financial attribution needs signed server-side form/CRM/call integrations.
- Batch/cached GSC enrichment, organization reporting timezone, comprehensive maintained Google country-domain coverage, and structured privacy-safe observability.
- Tel-setting changes require replacing the installed snippet; the UI now says so.

---

## Branch & State

- **Branch:** `feat/attribution-design-spec`
- **Merge base:** `35ed917` (tip of `main`)
- **Current HEAD:** `6182d0c`
- **Plan:** `docs/superpowers/plans/2026-09-12-attribution-phase1.md`
- **Progress ledger:** `.superpowers/sdd/progress.md`
- **Tasks 1–4:** Complete and reviewed
- **Task 5:** Implemented + reviewed — **two Important fixes needed** (see below)
- **Task 6:** Not started (Attribution Tab & Dashboard UI — 7 components)
- **Task 7:** Not started (End-to-End Verification)

## What to do next

### 1. Fix Task 5 (two Important findings)

**Fix A — Use existing `matchQueries` instead of hand-rolled GSC lookup:**

In `app/api/cron/attribution-queries/route.ts`, lines 23–53 hand-roll the `gsc_history_days` → `gsc_history_facts` → `rankQueries` lookup. But `lib/supabase/attribution.ts:276-311` already exports `matchQueries(clientId, landingPage, month)` doing exactly this with a more correct month-end calculation.

Replace the loop body to call `matchQueries(conv.clientId, conv.landingPage, monthDate)` directly. Remove the `createAdminClient` import (it's only used for the hand-rolled queries). Remove the `rankQueries` import too — `matchQueries` calls it internally.

**Fix B — Add error checking and per-conversion isolation:**

Wrap each iteration of the conversion loop in a try/catch so one failing conversion doesn't abort the entire cron run. This matches the pattern in `app/api/cron/reconcile-timesheets/route.ts` which isolates per-client failures. Also track and return error count.

After applying both fixes, the route should look roughly like:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getConversionsMissingQueries, updateConversionQueries, matchQueries } from '@/lib/supabase/attribution';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const conversions = await getConversionsMissingQueries(7);

    let matched = 0;
    let errors = 0;
    for (const conv of conversions) {
        try {
            const monthDate = typeof conv.month === 'string' ? conv.month.slice(0, 7) : new Date(conv.month).toISOString().slice(0, 7);
            const queries = await matchQueries(conv.clientId, conv.landingPage, monthDate);
            if (queries.length > 0) {
                await updateConversionQueries(conv.id, queries);
                matched++;
            }
        } catch (err) {
            errors++;
            console.error(`attribution-queries: failed for conversion ${conv.id}:`, err);
        }
    }

    return NextResponse.json({
        total: conversions.length,
        matched,
        errors,
        timestamp: new Date().toISOString(),
    });
}
```

After fixing, commit with message:
```
fix(attribution): use matchQueries and add per-conversion error isolation in cron
```

No test files to run for this — it's a cron route. Run `npx tsc --noEmit` to verify it compiles.

### 2. Update progress ledger

Append to `.superpowers/sdd/progress.md`:
```
Task 5: complete (commits 457aa4f..HEAD, fix wave then re-review clean)
  Fixed (Important): Replaced hand-rolled GSC lookup with existing matchQueries function.
  Fixed (Important): Added per-conversion try/catch isolation and error counting.
  Minor (deferred): Vercel Cron GET vs POST — all existing crons use POST only and work in production, so this follows the established pattern.
```

### 3. Implement Task 6: Attribution Tab & Dashboard UI

Extract the task brief:
```bash
bash .claude/plugins/cache/claude-plugins-official/superpowers/6.0.3/skills/subagent-driven-development/scripts/task-brief docs/superpowers/plans/2026-09-12-attribution-phase1.md 6
```

Task 6 creates 7 React components and wires them into the workspace page:
- `components/attribution/RoiCard.tsx` — revenue ROI card
- `components/attribution/SourceDonut.tsx` — donut chart of conversions by source
- `components/attribution/ConversionTimeline.tsx` — recharts line chart
- `components/attribution/ConversionLog.tsx` — table of recent conversions
- `components/attribution/LandingPagePerformance.tsx` — table with organic %
- `components/attribution/AttributionSetup.tsx` — script snippet + config
- `components/attribution/AttributionTab.tsx` — orchestrator tab component

Then wire `AttributionTab` into `app/(dashboard)/workspace/[id]/page.tsx` as a new tab.

**Key interfaces from earlier tasks:**
- `lib/supabase/attribution.ts` exports: `getAttributionSite`, `createAttributionSite`, `updateAttributionSite`, `getConversions`, `getEventCountsBySource`, `getLandingPagePerformance`
- `lib/types.ts` has: `AttributionSite`, `AttributionConversion`, `LikelyQuery`, `SourceCategory`, `ScriptConfig`
- `lib/supabase/clients.ts` — `rowToClientProject` maps `avg_deal_value` to `avgDealValue`
- Revenue is compute-on-read: `COUNT(conversions) × client.avgDealValue`

**Existing UI patterns to follow:**
- Tab structure: see how `ClientDeliverablesTab`, `MarketingPlanTab`, or `CampaignPlanTab` are wired into the workspace page
- Charts: the app uses `recharts` (see existing report components)
- Styling: Tailwind CSS v4, Radix/shadcn-style components in `components/ui/`
- Data fetching: client-side with `useEffect` + Supabase client, matching existing workspace tabs

### 4. Implement Task 7: End-to-End Verification

Extract brief:
```bash
bash .claude/plugins/cache/claude-plugins-official/superpowers/6.0.3/skills/subagent-driven-development/scripts/task-brief docs/superpowers/plans/2026-09-12-attribution-phase1.md 7
```

This task runs `npx tsc --noEmit`, runs `npm test` (existing tests + the new attribution tests), and verifies the dev server starts without errors.

### 5. Final review + push

After all tasks pass:
1. Run `npx tsc --noEmit` — must pass clean
2. Run `npm test` — all tests must pass
3. Push the branch: `git push -u origin feat/attribution-design-spec`
4. Create PR to main

## Global constraints (from plan + CLAUDE.md)

- **Never add `Co-Authored-By:` or any Anthropic trailer to commits**
- DB columns snake_case, TS types camelCase, bridged by `rowToX`/`xToRow` mappers
- Tests use `node:test` + `node:assert/strict`, NOT vitest. Run full suite with `npm test`
- RLS: all tables use `organization_id IN (SELECT get_user_org_ids())`
- Cron auth: `CRON_SECRET` bearer token
- Migrations numbered sequentially, mirrored into `schema.sql`
- No new migrations needed — migration 056 already covers all tables
- Compute-on-read for revenue (no stored aggregates)

## Files created/modified by this feature

```
lib/types.ts                                    — Attribution types added at end
lib/attribution/source-classifier.ts            — classifySource()
lib/attribution/source-classifier.test.ts       — 18 tests
lib/attribution/query-matcher.ts                — rankQueries()
lib/attribution/query-matcher.test.ts           — 5 tests
lib/supabase/attribution.ts                     — Full CRUD layer
lib/supabase/clients.ts                         — avgDealValue mapping added
migrations/056_attribution.sql                  — 3 tables + avg_deal_value column
schema.sql                                      — Mirror of 056
app/api/attribution/collect/route.ts            — POST collection endpoint
app/api/attribution/s.js/route.ts               — GET tracking script delivery
app/api/cron/attribution-queries/route.ts       — Daily query matching cron
app/api/cron/attribution-cleanup/route.ts       — Daily pageview cleanup cron
vercel.json                                     — 2 new cron entries
```

## Deferred items (do not fix now — tracked for future)

- Google-domain regex looser than suffix check (Task 1 Minor)
- `revoke` doesn't include service_role before re-granting — style only (Task 2 Minor)
- `getEventCountsBySource`/`getLandingPagePerformance` swallow query errors (Task 3 Minor)
- `same_site` fallback stores raw referrer as source_category (Task 4 Important, plan-mandated)
- Domain validation bypassed when Origin/Referer absent (Task 4 Important, plan-mandated)
- Rate limit map unbounded; no event_type validation before insert (Task 4 Minor)

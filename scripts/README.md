# Workbook → App import (Stage 3)

One-time historical import of the **SEO Ops Command Center** workbook into the
app's Supabase database. Two steps: extract (Python) → load (TypeScript).
Joins everything on `client_slug`; unmapped columns are preserved into
`custom_fields` (lossless). Business mappings reuse `lib/seo-ops-logic.ts`.

## Prerequisites

1. **Apply the schema migration first.** In the Supabase SQL editor, run
   [`migrations/003_seo_ops_domain.sql`](../migrations/003_seo_ops_domain.sql)
   (after 001 + 002). It's idempotent.
2. **Python deps:** `pip install openpyxl`
3. **Env:** create `.env.local` at the repo root with
   ```
   NEXT_PUBLIC_SUPABASE_URL=...        # your project URL
   SUPABASE_SERVICE_ROLE_KEY=...       # service-role key (bypasses RLS for the load)
   ```
4. **Node ≥ 23** (uses native TypeScript type-stripping and `--env-file`).
   This repo is on Node v24.

## Step 1 — extract

```bash
python3 scripts/export-workbook.py \
  --workbook "Sheet App Scrips/SEO Ops Command Center.xlsx"
```
Writes `scripts/workbook-data.json` and prints row counts + any warnings.
Re-run any time the workbook changes. (The xlsx is read with cached formula
values, so computed cells come through as real numbers.)

## Step 2 — load

```bash
# Dry run — prints what WOULD happen + the reconcile numbers, writes nothing:
node --env-file=.env.local scripts/import-workbook.ts

# Commit to the database:
node --env-file=.env.local scripts/import-workbook.ts --commit

# Clean reload (clears this org's imported data first — safe for a fresh internal org):
node --env-file=.env.local scripts/import-workbook.ts --commit --reset
```

- Target org defaults to **"Marketing Empire Group"**, created with
  `is_internal = true` (billing bypass) if it doesn't already exist. If you've
  already created it via signup/setup, the script reuses it and flags it internal.
  Override with `--org "Other Name"`.
- Account-manager names (Carlos / Abel) are matched to existing `users` by
  full name / first name / email local-part. If those users haven't signed up
  yet, the name is kept in `account_manager_name` and the FK is left null —
  re-run after they sign up to backfill the IDs.

## Step 3 — reconcile

The loader prints active-client count, total hours logged, and blogs delivered
this month. Compare these against the workbook's **Dashboard** / **Monthly SEO
Summary** tabs before retiring the sheet. Because hours are now a single source
of truth (`time_logs`), the app's Monthly Summary / Department Metrics are
computed from the imported logs — they should match the sheet's SUMIFS totals.

## Idempotency

- `clients` and `monthly_plans` upsert on natural keys, so re-running updates in
  place.
- `deliverables`, `time_logs`, `client_change_log`, `team_bonus` are insert-only;
  use `--reset` to clear and reload them cleanly.

## Notes

- `team_bonus` is extracted **best-effort** (the bonus sheet is bespoke). Review
  the imported rows and adjust in-app; the cap + KPI math lives in `teamBonus()`.
- GTM/CIPO audit tabs are intentionally **not** imported this phase.
